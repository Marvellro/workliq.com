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

export function planFromId(value: string | null | undefined): PlanId {
  if (value === 'starter' || value === 'growth') return value
  return 'free'
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
    })

    if (error) {
      console.error('[plans] entitlement lookup failed, defaulting to free:', error.message)
      return PLANS.free
    }

    const row = Array.isArray(data) ? data[0] : data
    if (!row || !isPaidStatus(row.status)) return PLANS.free

    return PLANS[planFromId(row.plan)]
  } catch (err) {
    console.error('[plans] entitlement lookup threw, defaulting to free:', err)
    return PLANS.free
  }
}

/**
 * Keeps `customers.ai_monthly_budget_usd` in step with the plan.
 *
 * The budget is duplicated onto the customer row rather than derived on every
 * AI call, for two reasons: the AI budget check runs on a hot path and should
 * not join through billing, and it lets an individual account be raised or
 * lowered by hand (a trial, a support gesture) without inventing a new plan.
 *
 * Called when a subscription changes. Only raises to the plan default if the
 * current value still equals another plan's default — a manually-set custom
 * budget is left alone, because overwriting a deliberate override on the next
 * billing webhook would be a genuinely baffling bug to diagnose.
 */
export async function syncAiBudgetToPlan(customerId: string, plan: PlanId): Promise<void> {
  const supabase = getSupabaseAdmin()

  const { data: customer, error } = await supabase
    .from('customers')
    .select('ai_monthly_budget_usd')
    .eq('id', customerId)
    .maybeSingle()

  if (error || !customer) return

  const current = Number(customer.ai_monthly_budget_usd)
  const planDefaults = Object.values(PLANS).map((p) => p.aiMonthlyBudgetUsd)
  const isUntouched = planDefaults.includes(current)

  if (!isUntouched) {
    console.log(
      `[plans] customer ${customerId} has a custom AI budget of ${current}; leaving it alone`
    )
    return
  }

  const target = PLANS[plan].aiMonthlyBudgetUsd
  if (current === target) return

  const { error: updateError } = await supabase
    .from('customers')
    .update({ ai_monthly_budget_usd: target, plan })
    .eq('id', customerId)

  if (updateError) {
    console.error('[plans] failed to sync AI budget:', updateError.message)
  } else {
    console.log(`[plans] customer ${customerId} → ${plan} (AI budget ${target})`)
  }
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
