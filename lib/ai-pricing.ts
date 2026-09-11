// Price table and cost arithmetic for AI steps.
//
// Deliberately a separate, dependency-free module: this is the code that
// decides what a customer is charged and whether their budget is exhausted, so
// it must be unit-testable without an API key, a network, or a database.

export const AI_MODEL = 'claude-opus-5' as const

// USD per million tokens. Cache reads are a tenth of the input rate; cache
// writes carry a 25% premium over it.
//
// Keep these in step with Anthropic's published pricing. ai_usage stores raw
// token counts alongside the computed cost precisely so historical rows can be
// re-costed if these change.
export const PRICING = {
  'claude-opus-5': {
    input: 5.0,
    output: 25.0,
    cacheRead: 0.5,
    cacheWrite: 6.25,
  },
} as const

export type ModelId = keyof typeof PRICING

export type TokenUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/**
 * Cost in USD for one model call.
 *
 * Returned at full precision — rounding happens only at display. Rounding here
 * would turn every sub-cent call into either 0 or a whole cent, and across
 * thousands of calls that error compounds into a figure that doesn't reconcile
 * against the real bill.
 */
export function computeCost(model: ModelId, usage: TokenUsage): number {
  const p = PRICING[model]
  const perToken = (rate: number, tokens: number) => (rate * tokens) / 1_000_000

  return (
    perToken(p.input, usage.inputTokens) +
    perToken(p.output, usage.outputTokens) +
    perToken(p.cacheRead, usage.cacheReadTokens ?? 0) +
    perToken(p.cacheWrite, usage.cacheWriteTokens ?? 0)
  )
}

/**
 * Worst-case cost of a call before making it, used for the pre-flight budget
 * check.
 *
 * Output tokens are unknown until the call completes, so this assumes the full
 * `maxOutputTokens`. That deliberately over-estimates: the alternative is
 * approving a call against a budget it then exceeds, and a customer discovering
 * they were billed past their own stated ceiling.
 */
export function estimateMaxCost(
  model: ModelId,
  inputTokens: number,
  maxOutputTokens: number
): number {
  return computeCost(model, { inputTokens, outputTokens: maxOutputTokens })
}

/** Formats a cost for display. Sub-cent amounts keep enough precision to be meaningful. */
export function formatUsd(amount: number): string {
  if (amount === 0) return '$0.00'
  if (amount < 0.01) return `$${amount.toFixed(4)}`
  return `$${amount.toFixed(2)}`
}

// ── Budget decisions ─────────────────────────────────────────────────────────

export type BudgetState = {
  spentUsd: number
  budgetUsd: number
  remainingUsd: number
}

export type BudgetDecision =
  | { allowed: true }
  | { allowed: false; reason: string }

/**
 * Decides whether a call may proceed against the customer's remaining budget.
 *
 * **Fails closed**, unlike the rate limiter. The difference is what each failure
 * costs: letting a rate-limited request through wastes a little capacity,
 * whereas letting an over-budget AI call through spends the customer's money
 * past a ceiling they set. When the amount at stake is real money, the safe
 * default is to refuse.
 */
export function checkBudget(state: BudgetState, estimatedCost: number): BudgetDecision {
  if (state.budgetUsd <= 0) {
    return { allowed: false, reason: 'AI steps are disabled for this account (budget is zero)' }
  }
  if (state.remainingUsd <= 0) {
    return {
      allowed: false,
      reason:
        `Monthly AI budget of ${formatUsd(state.budgetUsd)} is used up ` +
        `(${formatUsd(state.spentUsd)} spent). It resets at the start of next month.`,
    }
  }
  if (estimatedCost > state.remainingUsd) {
    return {
      allowed: false,
      reason:
        `This step could cost up to ${formatUsd(estimatedCost)} but only ` +
        `${formatUsd(state.remainingUsd)} of the monthly budget remains.`,
    }
  }
  return { allowed: true }
}
