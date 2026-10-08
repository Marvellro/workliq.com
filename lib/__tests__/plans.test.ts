import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  PLANS,
  planFromId,
  isPaidStatus,
  checkActionAllowed,
  planForPriceId,
  hasPriceTable,
  isWithinPeriod,
  ENTITLEMENT_GRACE_HOURS,
  effectiveAiBudget,
  bestPlan,
} from '../plans'

// Pure entitlement logic. The database-backed parts (getEntitlements,
// checkWorkflowLimit) are verified directly against Postgres instead.

describe('planFromId', () => {
  it('recognises the paid plans', () => {
    expect(planFromId('starter')).toBe('starter')
    expect(planFromId('growth')).toBe('growth')
  })

  it('falls back to free for anything unrecognised', () => {
    // Includes the case that actually matters: `customers.plan` was null for
    // every account before billing existed, and a null must never be read as
    // paid access.
    for (const value of [null, undefined, '', 'enterprise', 'STARTER', 'free']) {
      expect(planFromId(value)).toBe('free')
    }
  })
})

describe('isPaidStatus', () => {
  it('treats active and trialing as paid', () => {
    expect(isPaidStatus('active')).toBe(true)
    expect(isPaidStatus('trialing')).toBe(true)
  })

  it('treats every failure state as unpaid', () => {
    // past_due is the one worth being explicit about: a payment has already
    // failed, so it is not an entitlement.
    for (const status of [
      'past_due',
      'canceled',
      'unpaid',
      'incomplete',
      'incomplete_expired',
      'paused',
    ]) {
      expect(isPaidStatus(status)).toBe(false)
    }
  })

  it('treats missing status as unpaid', () => {
    expect(isPaidStatus(null)).toBe(false)
    expect(isPaidStatus(undefined)).toBe(false)
    expect(isPaidStatus('')).toBe(false)
  })
})

describe('plan definitions', () => {
  it('gives the free plan no AI budget', () => {
    // AI is the only action that costs money per run, so it must not be
    // reachable without a paid plan.
    expect(PLANS.free.aiMonthlyBudgetUsd).toBe(0)
  })

  it('increases limits monotonically up the tiers', () => {
    expect(PLANS.free.maxWorkflows).toBeLessThan(PLANS.starter.maxWorkflows)
    expect(PLANS.starter.maxWorkflows).toBeLessThan(PLANS.growth.maxWorkflows)
    expect(PLANS.free.aiMonthlyBudgetUsd).toBeLessThan(PLANS.starter.aiMonthlyBudgetUsd)
    expect(PLANS.starter.aiMonthlyBudgetUsd).toBeLessThan(PLANS.growth.aiMonthlyBudgetUsd)
  })

  it('leaves the free plan usable', () => {
    // A free plan with zero workflows cannot demonstrate the product.
    expect(PLANS.free.maxWorkflows).toBeGreaterThan(0)
  })
})

describe('checkActionAllowed', () => {
  it('blocks AI steps on the free plan', () => {
    const result = checkActionAllowed('ai_step', PLANS.free)
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.upgradeTo).toBe('starter')
  })

  it('blocks webhook actions on the free plan', () => {
    expect(checkActionAllowed('webhook', PLANS.free).allowed).toBe(false)
  })

  it('allows both on paid plans', () => {
    for (const plan of [PLANS.starter, PLANS.growth]) {
      expect(checkActionAllowed('ai_step', plan)).toEqual({ allowed: true })
      expect(checkActionAllowed('webhook', plan)).toEqual({ allowed: true })
    }
  })

  it('never blocks the actions every plan includes', () => {
    // Slack and Notion are the core product. Gating those would make the free
    // plan pointless rather than limited.
    for (const plan of Object.values(PLANS)) {
      expect(checkActionAllowed('slack_message', plan)).toEqual({ allowed: true })
      expect(checkActionAllowed('notion_row', plan)).toEqual({ allowed: true })
    }
  })

  it('names the upgrade in the message a customer sees', () => {
    const result = checkActionAllowed('ai_step', PLANS.free)
    if (!result.allowed) {
      expect(result.reason).toMatch(/Starter/)
    }
  })
})


describe('planForPriceId', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function configurePrices() {
    vi.stubEnv('STRIPE_PRICE_STARTER_MONTHLY', 'price_starter_m')
    vi.stubEnv('STRIPE_PRICE_STARTER_ANNUAL', 'price_starter_a')
    vi.stubEnv('STRIPE_PRICE_GROWTH_MONTHLY', 'price_growth_m')
    vi.stubEnv('STRIPE_PRICE_GROWTH_ANNUAL', 'price_growth_a')
  }

  it('maps each configured price to its plan and period', () => {
    configurePrices()
    expect(planForPriceId('price_starter_m')).toEqual({ plan: 'starter', billingPeriod: 'monthly' })
    expect(planForPriceId('price_starter_a')).toEqual({ plan: 'starter', billingPeriod: 'annual' })
    expect(planForPriceId('price_growth_m')).toEqual({ plan: 'growth', billingPeriod: 'monthly' })
    expect(planForPriceId('price_growth_a')).toEqual({ plan: 'growth', billingPeriod: 'annual' })
  })

  it('returns null for an unrecognised price', () => {
    // Must be null, never a default. Someone paying for a price we do not know
    // about is a problem to surface, not a reason to quietly assume free.
    configurePrices()
    expect(planForPriceId('price_from_another_account')).toBeNull()
  })

  it('returns null for a missing price id', () => {
    configurePrices()
    expect(planForPriceId(null)).toBeNull()
    expect(planForPriceId(undefined)).toBeNull()
    expect(planForPriceId('')).toBeNull()
  })

  it('does not match when the variables are unset', () => {
    // An unset variable is undefined; an undefined price id must not collide
    // with it and silently grant a plan.
    vi.stubEnv('STRIPE_PRICE_STARTER_MONTHLY', '')
    vi.stubEnv('STRIPE_PRICE_STARTER_ANNUAL', '')
    vi.stubEnv('STRIPE_PRICE_GROWTH_MONTHLY', '')
    vi.stubEnv('STRIPE_PRICE_GROWTH_ANNUAL', '')
    expect(hasPriceTable()).toBe(false)
    expect(planForPriceId(undefined)).toBeNull()
    expect(planForPriceId('')).toBeNull()
  })

  it('works with only some prices configured', () => {
    // Half-configured is a realistic state mid-migration to live mode.
    vi.stubEnv('STRIPE_PRICE_STARTER_MONTHLY', 'price_only_one')
    vi.stubEnv('STRIPE_PRICE_STARTER_ANNUAL', '')
    vi.stubEnv('STRIPE_PRICE_GROWTH_MONTHLY', '')
    vi.stubEnv('STRIPE_PRICE_GROWTH_ANNUAL', '')
    expect(hasPriceTable()).toBe(true)
    expect(planForPriceId('price_only_one')).toEqual({ plan: 'starter', billingPeriod: 'monthly' })
    expect(planForPriceId('price_growth_m')).toBeNull()
  })

  it('reads the environment at call time, not at import', () => {
    // The module must not snapshot these at import: a server process that
    // starts before billing is configured would then never see the prices.
    expect(planForPriceId('price_late')).toBeNull()
    vi.stubEnv('STRIPE_PRICE_GROWTH_ANNUAL', 'price_late')
    expect(planForPriceId('price_late')).toEqual({ plan: 'growth', billingPeriod: 'annual' })
  })
})


describe('isWithinPeriod', () => {
  // Fixed clock: these assert a rule, not what day it happens to be.
  const NOW = Date.parse('2026-09-30T12:00:00.000Z')
  const HOUR = 60 * 60 * 1000

  function hoursPast(n: number): string {
    return new Date(NOW - n * HOUR).toISOString()
  }

  it('accepts a period that has not ended', () => {
    expect(isWithinPeriod(new Date(NOW + HOUR).toISOString(), NOW)).toBe(true)
    expect(isWithinPeriod(new Date(NOW + 30 * 24 * HOUR).toISOString(), NOW)).toBe(true)
  })

  it('accepts a lapse inside the grace window', () => {
    // The case this window exists for: Stripe's renewal webhook running late
    // must not drop a paying customer to Free the moment the period rolls over.
    expect(isWithinPeriod(hoursPast(1), NOW)).toBe(true)
    expect(isWithinPeriod(hoursPast(24), NOW)).toBe(true)
    expect(isWithinPeriod(hoursPast(ENTITLEMENT_GRACE_HOURS - 1), NOW)).toBe(true)
  })

  it('rejects a lapse past the grace window', () => {
    expect(isWithinPeriod(hoursPast(ENTITLEMENT_GRACE_HOURS + 1), NOW)).toBe(false)
    expect(isWithinPeriod(hoursPast(24 * 30), NOW)).toBe(false)
  })

  it('treats the exact boundary as expired', () => {
    // end + grace > now, so equality falls on the expired side. Stated as a
    // test because "48 hours" alone does not say which way the boundary goes.
    expect(isWithinPeriod(hoursPast(ENTITLEMENT_GRACE_HOURS), NOW)).toBe(false)
  })

  it('never expires a null end date', () => {
    // The escape hatch for an indefinite comp. Also the one remaining way an
    // entitlement can outlive its intent, so it is asserted rather than assumed.
    expect(isWithinPeriod(null, NOW)).toBe(true)
    expect(isWithinPeriod(undefined, NOW)).toBe(true)
    expect(isWithinPeriod('', NOW)).toBe(true)
  })

  it('treats an unparseable date as expired', () => {
    // A corrupt row must not be worth more than a valid expired one. The rest
    // of this module already resolves "cannot determine" to free.
    expect(isWithinPeriod('not-a-date', NOW)).toBe(false)
    expect(isWithinPeriod('2026-13-45T99:99:99Z', NOW)).toBe(false)
  })

  it('accepts a Date as well as a string', () => {
    expect(isWithinPeriod(new Date(NOW + HOUR), NOW)).toBe(true)
    expect(isWithinPeriod(new Date(NOW - 72 * HOUR), NOW)).toBe(false)
  })

  it('rejects the lapse that was live in production', () => {
    // The regression this was written for: the walkthrough comp ended
    // 2026-09-22 and was still granting Growth on 2026-09-30, because nothing
    // compared the date to the clock.
    expect(isWithinPeriod('2026-09-22T19:59:03.866Z', Date.parse('2026-09-30T12:00:00Z'))).toBe(
      false
    )
    // Still valid the morning after it ended — grace, working as intended.
    expect(isWithinPeriod('2026-09-22T19:59:03.866Z', Date.parse('2026-09-23T12:00:00Z'))).toBe(
      true
    )
  })
})


describe('effectiveAiBudget', () => {
  // Replaces a heuristic that inferred "someone set this by hand" from the
  // value not matching a plan default. That guess was wrong in both directions
  // and both were live in production:
  //
  //   a customer who bought Starter kept a stale 7.50 against an advertised $10
  //   every new signup kept the 5.00 column default forever, while Free is $0
  //
  // An override is now a column that says so, and these assert it is obeyed
  // rather than second-guessed.

  it('uses the plan default when there is no override', () => {
    expect(effectiveAiBudget(null, 'free')).toBe(0)
    expect(effectiveAiBudget(null, 'starter')).toBe(10)
    expect(effectiveAiBudget(undefined, 'growth')).toBe(50)
  })

  it('honours an override above the plan default', () => {
    // The case the old guard existed to protect: a support gesture must
    // survive the next billing webhook.
    expect(effectiveAiBudget(25, 'starter')).toBe(25)
  })

  it('honours an override below the plan default', () => {
    // The direction the old guard could not express. Throttling one account
    // is a legitimate decision, and it has to be distinguishable from a stale
    // value — which is the whole point of the column.
    expect(effectiveAiBudget(2, 'growth')).toBe(2)
    expect(effectiveAiBudget(0, 'starter')).toBe(0)
  })

  it('accepts the numeric string Postgres returns', () => {
    // numeric(10,2) comes back as a string through PostgREST, which is how
    // 7.50 reached the old comparison in the first place.
    expect(effectiveAiBudget('25.00', 'starter')).toBe(25)
    expect(effectiveAiBudget('0.00', 'growth')).toBe(0)
  })

  it('does not let a stale value masquerade as an override', () => {
    // The regression. 7.50 and 5.00 were preserved indefinitely because they
    // matched no plan default. With the override null they are now simply
    // overwritten by what the account is actually on.
    expect(effectiveAiBudget(null, 'starter')).toBe(10)
    expect(effectiveAiBudget(null, 'free')).toBe(0)
  })

  it('falls back to the plan default on an unusable override', () => {
    // A corrupt row is not an instruction. Falling back leaves the account at
    // exactly what it pays for rather than at zero or at something arbitrary.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(effectiveAiBudget('not-a-number', 'starter')).toBe(10)
    expect(effectiveAiBudget(-5, 'growth')).toBe(50)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})


describe('bestPlan', () => {
  // The entitlement function used to apply `limit 1` to a sort key that ties:
  // claim_subscription_for_customer stamps every row it links with the same
  // updated_at, so two subscriptions for one customer match to the microsecond.
  // Which plan an account resolved to was decided by whichever row Postgres
  // reached first — correct so far only because the one account with two rows
  // has an expired comp that the date filter removes before ordering runs.

  it('returns free for no entitlements', () => {
    expect(bestPlan([])).toBe('free')
  })

  it('returns the only entitlement when there is one', () => {
    expect(bestPlan([{ plan: 'starter' }])).toBe('starter')
  })

  it('gives the most generous when an account holds several', () => {
    // A comp alongside a purchase is the obvious case. Charging someone for
    // Growth and giving them Starter is the outcome worth ruling out.
    expect(bestPlan([{ plan: 'starter' }, { plan: 'growth' }])).toBe('growth')
    expect(bestPlan([{ plan: 'growth' }, { plan: 'starter' }])).toBe('growth')
  })

  it('does not depend on the order it receives them in', () => {
    // The whole bug was an outcome that depended on row order. This asserts the
    // replacement does not.
    const rows = [{ plan: 'free' }, { plan: 'growth' }, { plan: 'starter' }]
    const forwards = bestPlan(rows)
    const backwards = bestPlan([...rows].reverse())
    expect(forwards).toBe('growth')
    expect(backwards).toBe('growth')
  })

  it('ignores plans it does not recognise', () => {
    // planFromId resolves anything unknown to free, so an unrecognised plan
    // cannot win by being unfamiliar.
    expect(bestPlan([{ plan: 'enterprise' }, { plan: 'starter' }])).toBe('starter')
    expect(bestPlan([{ plan: null }, { plan: undefined }])).toBe('free')
  })
})
