import { describe, it, expect } from 'vitest'
import {
  computeCost,
  estimateMaxCost,
  checkBudget,
  formatUsd,
  PRICING,
  AI_MODEL,
} from '../ai-pricing'

// This module decides what a customer is charged and whether an AI step is
// allowed to spend their money, so it is kept free of network and database
// dependencies and tested directly.

describe('computeCost', () => {
  it('prices input and output at the published rates', () => {
    // 1M input + 1M output on Opus 5 = $5 + $25.
    expect(computeCost(AI_MODEL, { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(30, 6)
  })

  it('prices a realistic single deal summary', () => {
    // ~700 in, ~150 out — the actual shape of these calls.
    const cost = computeCost(AI_MODEL, { inputTokens: 700, outputTokens: 150 })
    expect(cost).toBeCloseTo(700 * 5e-6 + 150 * 25e-6, 9)
    // Sanity: a fraction of a cent, so a thousand runs is single-digit dollars.
    expect(cost).toBeLessThan(0.01)
  })

  it('prices cache reads at a tenth of the input rate', () => {
    expect(PRICING[AI_MODEL].cacheRead).toBeCloseTo(PRICING[AI_MODEL].input / 10, 6)
    const cached = computeCost(AI_MODEL, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 })
    expect(cached).toBeCloseTo(0.5, 6)
  })

  it('prices cache writes at a premium over input', () => {
    expect(PRICING[AI_MODEL].cacheWrite).toBeGreaterThan(PRICING[AI_MODEL].input)
    const written = computeCost(AI_MODEL, { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000 })
    expect(written).toBeCloseTo(6.25, 6)
  })

  it('treats omitted cache fields as zero', () => {
    expect(computeCost(AI_MODEL, { inputTokens: 100, outputTokens: 100 })).toBe(
      computeCost(AI_MODEL, { inputTokens: 100, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 })
    )
  })

  it('is zero for a call that consumed nothing', () => {
    expect(computeCost(AI_MODEL, { inputTokens: 0, outputTokens: 0 })).toBe(0)
  })

  it('does not round sub-cent amounts away', () => {
    // Rounding here would make every cheap call cost 0, and a thousand of them
    // would still total 0 — the meter would under-report indefinitely.
    const cost = computeCost(AI_MODEL, { inputTokens: 10, outputTokens: 1 })
    expect(cost).toBeGreaterThan(0)
    expect(cost).toBeLessThan(0.001)
  })
})

describe('estimateMaxCost', () => {
  it('assumes the full output allowance', () => {
    // Output length is unknown before the call, so the pre-flight estimate must
    // assume the worst — approving against an optimistic estimate is how you
    // bill a customer past their own ceiling.
    const estimate = estimateMaxCost(AI_MODEL, 700, 1200)
    const actualIfShort = computeCost(AI_MODEL, { inputTokens: 700, outputTokens: 150 })
    expect(estimate).toBeGreaterThan(actualIfShort)
    expect(estimate).toBeCloseTo(computeCost(AI_MODEL, { inputTokens: 700, outputTokens: 1200 }), 9)
  })
})

describe('checkBudget', () => {
  const healthy = { spentUsd: 1, budgetUsd: 5, remainingUsd: 4 }

  it('allows a call comfortably inside the budget', () => {
    expect(checkBudget(healthy, 0.01)).toEqual({ allowed: true })
  })

  it('refuses when the budget is exhausted', () => {
    const result = checkBudget({ spentUsd: 5, budgetUsd: 5, remainingUsd: 0 }, 0.01)
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      // The message is shown to the customer, so it must say what happened and
      // when it resolves.
      expect(result.reason).toMatch(/used up/)
      expect(result.reason).toMatch(/next month/)
    }
  })

  it('refuses when a single call would exceed what remains', () => {
    // The important case: budget is not exhausted, but this call would take it
    // past the ceiling. Allowing it would overspend by design.
    const result = checkBudget({ spentUsd: 4.995, budgetUsd: 5, remainingUsd: 0.005 }, 0.03)
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toMatch(/could cost up to/)
  })

  it('refuses when AI is disabled via a zero budget', () => {
    const result = checkBudget({ spentUsd: 0, budgetUsd: 0, remainingUsd: 0 }, 0.001)
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toMatch(/disabled/)
  })

  it('refuses on a negative remaining balance', () => {
    // Overspend can happen if a call costs more than estimated; the next one
    // must still be refused rather than compounding it.
    expect(checkBudget({ spentUsd: 6, budgetUsd: 5, remainingUsd: -1 }, 0.001).allowed).toBe(false)
  })

  it('allows a call that exactly consumes the remainder', () => {
    expect(checkBudget({ spentUsd: 4.9, budgetUsd: 5, remainingUsd: 0.1 }, 0.1)).toEqual({
      allowed: true,
    })
  })
})

describe('formatUsd', () => {
  it('keeps precision on sub-cent amounts', () => {
    // "$0.00" next to a real charge looks like a bug or like it was free.
    expect(formatUsd(0.0034)).toBe('$0.0034')
  })

  it('uses two decimals for ordinary amounts', () => {
    expect(formatUsd(1.5)).toBe('$1.50')
    expect(formatUsd(12.345)).toBe('$12.35')
  })

  it('renders exact zero plainly', () => {
    expect(formatUsd(0)).toBe('$0.00')
  })
})
