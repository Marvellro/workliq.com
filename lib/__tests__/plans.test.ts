import { describe, it, expect } from 'vitest'
import { PLANS, planFromId, isPaidStatus, checkActionAllowed } from '../plans'

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
