import { describe, it, expect, vi, afterEach } from 'vitest'
import type Stripe from 'stripe'
import { subscriptionPeriodEnd } from '../job-handlers'

// Regression cover for a bug that made the entitlement expiry check inert.
//
// Stripe removed current_period_end from the Subscription object in API
// version 2025-03-31.basil. The handler still read it from there through an
// `as unknown as` cast, so it type-checked, evaluated to undefined at runtime,
// and stored null for every real subscription — and a null period end never
// expires. Nothing failed; entitlements simply could not lapse.

const HOUR = 3600

function subscription(itemEnds: (number | undefined)[]): Stripe.Subscription {
  return {
    id: 'sub_test',
    items: {
      data: itemEnds.map((current_period_end, i) => ({
        id: `si_${i}`,
        current_period_end,
      })),
    },
  } as unknown as Stripe.Subscription
}

afterEach(() => vi.restoreAllMocks())

describe('subscriptionPeriodEnd', () => {
  it('reads the period from the subscription item', () => {
    const end = Date.parse('2026-10-15T00:00:00.000Z') / 1000
    expect(subscriptionPeriodEnd(subscription([end]))).toBe('2026-10-15T00:00:00.000Z')
  })

  it('takes the earliest across mixed-interval items', () => {
    // Stripe defines the subscription's own period as ending at the earliest
    // item period. That is also the right one to gate on: the next moment
    // something on this subscription must be paid for again.
    const oct = Date.parse('2026-10-15T00:00:00.000Z') / 1000
    const nov = Date.parse('2026-11-15T00:00:00.000Z') / 1000
    const dec = Date.parse('2026-12-15T00:00:00.000Z') / 1000
    expect(subscriptionPeriodEnd(subscription([dec, oct, nov]))).toBe('2026-10-15T00:00:00.000Z')
  })

  it('ignores items with no usable period', () => {
    const end = Date.parse('2026-10-15T00:00:00.000Z') / 1000
    expect(subscriptionPeriodEnd(subscription([undefined, end]))).toBe('2026-10-15T00:00:00.000Z')
    expect(subscriptionPeriodEnd(subscription([NaN, end]))).toBe('2026-10-15T00:00:00.000Z')
  })

  it('returns null and warns when no item has a period', () => {
    // Fail-open, matching the grace window's reasoning: wrongly cutting off
    // someone who has paid is worse than briefly over-granting. Loud, because
    // it should not happen.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(subscriptionPeriodEnd(subscription([]))).toBeNull()
    expect(subscriptionPeriodEnd({ id: 'sub_x' } as unknown as Stripe.Subscription)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('never reads a top-level current_period_end', () => {
    // The precise regression. A subscription carrying the legacy top-level
    // field must not be believed over its items — on a pinned modern API
    // version that field does not exist, and trusting it is what produced
    // nulls in the first place.
    const legacy = Date.parse('2030-01-01T00:00:00.000Z') / 1000
    const item = Date.parse('2026-10-15T00:00:00.000Z') / 1000
    const sub = {
      id: 'sub_legacy',
      current_period_end: legacy,
      items: { data: [{ id: 'si_0', current_period_end: item }] },
    } as unknown as Stripe.Subscription

    expect(subscriptionPeriodEnd(sub)).toBe('2026-10-15T00:00:00.000Z')
  })

  it('produces a value the entitlement check can actually use', () => {
    // The two halves have to meet: what the handler stores must be a string
    // isWithinPeriod parses. This is the seam the bug fell through.
    const end = Math.floor(Date.now() / 1000) + 24 * HOUR
    const stored = subscriptionPeriodEnd(subscription([end]))
    expect(stored).not.toBeNull()
    expect(Number.isNaN(Date.parse(stored as string))).toBe(false)
  })
})
