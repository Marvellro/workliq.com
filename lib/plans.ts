import { getSupabaseAdmin } from './config'

// Plan definitions and entitlement resolution.
//
// Limits live in code rather than the database on purpose: they are product
// decisions that should move with a deploy and be reviewable in a diff, not
// values someone can quietly change in a SQL console with no record of why.
// What a *particular customer* is on lives in the database; what each plan
// *means* lives here.

export type PlanId = 'free' | 'starter' | 'growth'

export type Entitlements = {
  plan: PlanId
  /** Maximum enabled workflows. */
  maxWorkflows: number
  /** Monthly AI spend ceiling in USD. 0 disables AI steps. */
  aiMonthlyBudgetUsd: number
  /** Whether the webhook action is available. */
  webhookActions: boolean
  label: string
}

export const PLANS: Record<PlanId, Entitlements> = {
  // Everyone starts here, including anyone who has not paid yet. It is
  // deliberately usable — one working workflow proves the product — but with no
  // AI budget, since AI is the part that costs us money per run.
  free: {
    plan: 'free',
    maxWorkflows: 1,
    aiMonthlyBudgetUsd: 0,
    webhookActions: false,
    label: 'Free',
  },
  starter: {
    plan: 'starter',
    maxWorkflows: 10,
    aiMonthlyBudgetUsd: 10,
    webhookActions: true,
    label: 'Starter',
  },
  growth: {
    plan: 'growth',
    maxWorkflows: 50,
    aiMonthlyBudgetUsd: 50,
    webhookActions: true,
    label: 'Growth',
  },
}

// Stripe subscription statuses that count as paid.
//
// Everything else — past_due, canceled, unpaid, incomplete, incomplete_expired
// — falls back to free. A subscription that is not being paid for is not an
// entitlement, and `past_due` in particular is the case worth being firm about:
// it means a payment has already failed.
const PAID_STATUSES = new Set(['active', 'trialing'])

export function isPaidStatus(status: string | null | undefined): boolean {
  return Boolean(status && PAID_STATUSES.has(status))
}

/**
 * How long past `current_period_end` a subscription still counts.
 *
 * Owned here and passed into `entitlements_for_customer`, so the threshold
 * exists once rather than in two places that drift.
 *
 * Deliberately generous, and deliberately asymmetric. Stripe advances
 * current_period_end via the renewal webhook; without a window, a webhook that
 * arrives late drops a genuinely paying customer to Free the moment their
 * period rolls over. Wrongly denying access to someone who has paid is a worse
 * failure than briefly over-granting to someone who has not — the same
 * asymmetry as the AI budget failing closed while the rate limiter fails open.
 */
export const ENTITLEMENT_GRACE_HOURS = 48

/**
 * Whether a subscription period is still current, allowing for grace.
 *
 * A null end date never expires: that is the escape hatch for an indefinite
 * comp, where setting a date is what makes the grant temporary. It is also the
 * one way an entitlement can still outlive its intent, so it is worth knowing
 * about when granting one.
 *
 * An unparseable date resolves to expired. It means the row is corrupt, and the
 * rest of this module already treats "cannot determine entitlement" as free.
 */
export function isWithinPeriod(
  currentPeriodEnd: string | Date | null | undefined,
  now: number = Date.now()
): boolean {
  if (currentPeriodEnd === null || currentPeriodEnd === undefined || currentPeriodEnd === '') {
    return true
  }

  const endedAt = currentPeriodEnd instanceof Date
    ? currentPeriodEnd.getTime()
    : new Date(currentPeriodEnd).getTime()

  if (Number.isNaN(endedAt)) return false

  return endedAt + ENTITLEMENT_GRACE_HOURS * 60 * 60 * 1000 > now
}

export function planFromId(value: string | null | undefined): PlanId {
  if (value === 'starter' || value === 'growth') return value
  return 'free'
}

/**
 * Ordering of plans by how much they grant.
 *
 * Lives here with the plan definitions rather than in the entitlement SQL,
 * which is the same reason the limits do: what a plan means is a product
 * decision that should move with a deploy. A copy in the database would be the
 * one nobody remembers to change.
 */
const PLAN_RANK: Record<PlanId, number> = { free: 0, starter: 1, growth: 2 }

/**
 * Picks the entitlement an account should actually get.
 *
 * An account can hold more than one valid subscription — a comp alongside a
 * purchase, most obviously. When that happens the customer gets the most
 * generous of them, because the alternative is charging someone for Growth and
 * giving them Starter.
 *
 * Returns free for an empty list. Deliberately total rather than throwing:
 * every caller already treats "no entitlement" as free.
 */
export function bestPlan(rows: { plan?: string | null }[]): PlanId {
  let best: PlanId = 'free'
  for (const row of rows) {
    const candidate = planFromId(row.plan)
    if (PLAN_RANK[candidate] > PLAN_RANK[best]) best = candidate
  }
  return best
}

// ── Price IDs → plans ────────────────────────────────────────────────────────

export type BillingPeriod = 'monthly' | 'annual'
export type PriceMapping = { plan: PlanId; billingPeriod: BillingPeriod }

// Built from the same four environment variables the checkout route charges
// against, rather than a second hand-maintained list. A separate list would
// eventually disagree with what customers are actually billed, and the symptom
// would be someone paying for one plan and receiving another.
//
// Read lazily: these are server-only vars, and a module that throws at import
// time because billing isn't configured would take down pages that have nothing
// to do with billing.
function priceTable(): { id: string; plan: PlanId; billingPeriod: BillingPeriod }[] {
  const entries: [string | undefined, PlanId, BillingPeriod][] = [
    [process.env.STRIPE_PRICE_STARTER_MONTHLY, 'starter', 'monthly'],
    [process.env.STRIPE_PRICE_STARTER_ANNUAL, 'starter', 'annual'],
    [process.env.STRIPE_PRICE_GROWTH_MONTHLY, 'growth', 'monthly'],
    [process.env.STRIPE_PRICE_GROWTH_ANNUAL, 'growth', 'annual'],
  ]
  return entries
    .filter((e): e is [string, PlanId, BillingPeriod] => Boolean(e[0]))
    .map(([id, plan, billingPeriod]) => ({ id, plan, billingPeriod }))
}

/**
 * Resolves a Stripe price ID to the plan it grants.
 *
 * This is the authoritative mapping. The plan used to be read only from
 * `subscription.metadata.plan`, which the checkout route sets — and that breaks
 * in two ways that both end with someone paying for the wrong thing:
 *
 *   • A customer upgrading Starter → Growth in Stripe's Billing Portal changes
 *     the *price*. The metadata, written once at checkout, does not change. They
 *     would pay for Growth and keep Starter's limits.
 *   • A subscription created in the Stripe dashboard, from a payment link, or
 *     migrated in has no metadata at all, and would resolve to free.
 *
 * Returns null when the price is unrecognised, which callers must treat as a
 * problem to report rather than a reason to assume free.
 */
export function planForPriceId(priceId: string | null | undefined): PriceMapping | null {
  if (!priceId) return null
  const match = priceTable().find((p) => p.id === priceId)
  return match ? { plan: match.plan, billingPeriod: match.billingPeriod } : null
}

/** True when at least one price ID is configured — used to warn on misconfiguration. */
export function hasPriceTable(): boolean {
  return priceTable().length > 0
}

/**
 * Resolves what an account is currently entitled to.
 *
 * Falls back to the free plan on any error rather than throwing. This is called
 * on the request path for workflow creation, and a database hiccup should
 * degrade a customer to free limits for one request — not return a 500 on a
 * page they were trying to use.
 */
export async function getEntitlements(customerId: string): Promise<Entitlements> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc('entitlements_for_customer', {
      p_customer_id: customerId,
      p_grace_hours: ENTITLEMENT_GRACE_HOURS,
    })

    if (error) {
      console.error('[plans] entitlement lookup failed, defaulting to free:', error.message)
      return PLANS.free
    }

    // Every valid entitlement, not just one. The function used to apply its own
    // `limit 1` on a sort key that ties — claim_subscription_for_customer
    // stamps every linked row with the same updated_at — so which plan an
    // account resolved to was decided by whichever row Postgres reached first.
    const rows = (Array.isArray(data) ? data : data ? [data] : []) as {
      plan?: string | null
      status?: string | null
      current_period_end?: string | null
    }[]

    const usable = rows.filter((row) => {
      if (!isPaidStatus(row.status)) return false

      // The SQL already filters on the period, so this is defence rather than
      // the primary gate — but it is where the rule is testable, and it means a
      // direct caller, or a future query that forgets the filter, cannot hand
      // out a lapsed plan. It is why `current_period_end` is returned at all.
      if (!isWithinPeriod(row.current_period_end)) {
        console.warn(
          `[plans] a subscription for ${customerId} is past its period end — ignoring it`
        )
        return false
      }
      return true
    })

    if (usable.length === 0) return PLANS.free

    return PLANS[bestPlan(usable)]
  } catch (err) {
    console.error('[plans] entitlement lookup threw, defaulting to free:', err)
    return PLANS.free
  }
}

/**
 * Resolves the effective AI ceiling for an account.
 *
 * An override is authoritative in both directions — above the plan default for
 * a support gesture, below it for an account being throttled. It is a number
 * someone chose, so it is used as given.
 */
export function effectiveAiBudget(
  override: number | string | null | undefined,
  plan: PlanId
): number {
  if (override === null || override === undefined || override === '') {
    return PLANS[plan].aiMonthlyBudgetUsd
  }

  const value = Number(override)
  // A non-numeric override is a corrupt row, not an instruction. Falling back
  // to the plan default keeps the account at exactly what it pays for.
  if (!Number.isFinite(value) || value < 0) {
    console.warn(`[plans] ignoring unusable ai_budget_override_usd: ${String(override)}`)
    return PLANS[plan].aiMonthlyBudgetUsd
  }

  return value
}

/**
 * Keeps `customers.ai_monthly_budget_usd` and `customers.plan` in step.
 *
 * The budget is materialised onto the customer row rather than derived on every
 * AI call because the check runs on a hot path and should not join through
 * billing to find a number. Plan defaults live in this file, so the database
 * cannot derive it either — hence a column that something has to write.
 *
 * This used to decide whether to write by guessing: a value matching no plan
 * default must have been set by hand, so leave it alone. The intent was right —
 * a support gesture of $25 on Starter should survive the next billing webhook —
 * but inferring intent from the value was wrong in both directions, and both
 * were live. A customer who bought Starter kept a stale 7.50 against an
 * advertised $10, and every new signup kept the 5.00 column default forever
 * while Free is $0.
 *
 * So the override is now a column that says so, and this write is
 * unconditional. `plan` is included because it was never an override field; it
 * only ever looked like one by sharing the same early return.
 */
export async function syncAiBudgetToPlan(customerId: string, plan: PlanId): Promise<void> {
  const supabase = getSupabaseAdmin()

  const { data: customer, error } = await supabase
    .from('customers')
    .select('ai_monthly_budget_usd, ai_budget_override_usd, plan')
    .eq('id', customerId)
    .maybeSingle()

  if (error || !customer) return

  const target = effectiveAiBudget(customer.ai_budget_override_usd, plan)

  // Still skip the write when nothing would change — but on the actual values
  // now, not on a guess about where they came from.
  if (Number(customer.ai_monthly_budget_usd) === target && customer.plan === plan) return

  const { error: updateError } = await supabase
    .from('customers')
    .update({ ai_monthly_budget_usd: target, plan })
    .eq('id', customerId)

  if (updateError) {
    console.error('[plans] failed to sync AI budget:', updateError.message)
    return
  }

  const suffix =
    customer.ai_budget_override_usd === null || customer.ai_budget_override_usd === undefined
      ? ''
      : ' (override)'
  console.log(`[plans] customer ${customerId} → ${plan} (AI budget ${target}${suffix})`)
}

// ── Limit checks ─────────────────────────────────────────────────────────────

export type LimitCheck =
  | { allowed: true }
  | { allowed: false; reason: string; upgradeTo?: PlanId }

/**
 * Checks whether another workflow may be created.
 *
 * Counts only enabled workflows, so a customer at their limit can disable one
 * and build another without contacting support.
 */
export async function checkWorkflowLimit(
  customerId: string,
  entitlements: Entitlements
): Promise<LimitCheck> {
  const { count, error } = await getSupabaseAdmin()
    .from('workflows')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)
    .eq('enabled', true)

  if (error) {
    // Don't block a paying customer because of a counting error.
    console.error('[plans] workflow count failed, allowing:', error.message)
    return { allowed: true }
  }

  if ((count ?? 0) >= entitlements.maxWorkflows) {
    const upgradeTo: PlanId | undefined =
      entitlements.plan === 'free' ? 'starter' : entitlements.plan === 'starter' ? 'growth' : undefined

    return {
      allowed: false,
      reason:
        `The ${entitlements.label} plan includes ${entitlements.maxWorkflows} ` +
        `active workflow${entitlements.maxWorkflows === 1 ? '' : 's'}. ` +
        (upgradeTo
          ? `Upgrade to ${PLANS[upgradeTo].label} for ${PLANS[upgradeTo].maxWorkflows}, or disable one to make room.`
          : 'Disable one to make room.'),
      upgradeTo,
    }
  }

  return { allowed: true }
}

/** Checks whether an action type is available on this plan. */
export function checkActionAllowed(
  actionType: string,
  entitlements: Entitlements
): LimitCheck {
  if (actionType === 'webhook' && !entitlements.webhookActions) {
    return {
      allowed: false,
      reason: `Webhook actions are available on the Starter plan and above.`,
      upgradeTo: 'starter',
    }
  }
  if (actionType === 'ai_step' && entitlements.aiMonthlyBudgetUsd <= 0) {
    return {
      allowed: false,
      reason: `AI steps are available on the Starter plan and above.`,
      upgradeTo: 'starter',
    }
  }
  return { allowed: true }
}
