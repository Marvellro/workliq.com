import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  PLANS,
  planFromId,
  isPaidStatus,
  checkActionAllowed,
  planForPriceId,
  hasPriceTable,
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
