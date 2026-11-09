import { describe, it, expect, vi, afterEach } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'

// When our Anthropic account refuses a request — out of credit, key missing or
// rejected, billing, permission — every customer's AI steps fail at once and
// none of them can fix it. "Send a test" found the account out of credit on
// 9 Nov 2026, and showed the refusal reaching the customer as a permanent
// failure that said "go to Plans & Billing", charged to their AI budget.
//
// The errors below are built with the SDK's own APIError.generate — the
// factory it uses on a live response — from the exact body production
// returned, so the classifier is tested against the objects it really gets.

const { inserted } = vi.hoisted(() => ({ inserted: [] as Record<string, unknown>[] }))

vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        inserted.push({ table, ...row })
        return { error: null }
      },
    }),
  }),
}))

import {
  providerAccountFailure,
  failureOutcome,
  runAIStep,
  AIProviderUnavailableError,
  AIConfigError,
  AI_PROVIDER_UNAVAILABLE_MESSAGE,
  PROVIDER_REFUSAL_MARK,
} from '../ai'

function apiError(status: number, type: string, message: string) {
  return Anthropic.APIError.generate(
    status,
    { type: 'error', error: { type, message }, request_id: 'req_test' },
    undefined,
    new Headers()
  )
}

// Verbatim from production, 9 Nov 2026: a 400, typed like a malformed request.
const CREDIT_TEXT =
  'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'
const credit = () => apiError(400, 'invalid_request_error', CREDIT_TEXT)

afterEach(() => {
  inserted.length = 0
  vi.unstubAllEnvs()
})

describe('providerAccountFailure — refusals of our account', () => {
  const ours: [string, () => unknown][] = [
    ['400, credit balance too low', credit],
    ['401, key rejected', () => apiError(401, 'authentication_error', 'invalid x-api-key')],
    ['402, billing', () => apiError(402, 'billing_error', 'There is an issue with your billing')],
    ['403, key not permitted', () => apiError(403, 'permission_error', 'Your API key does not have permission')],
    ['404, model not available to the org', () => apiError(404, 'not_found_error', 'model: claude-x')],
  ]
  for (const [name, make] of ours) {
    it(`recognises ${name}`, () => {
      expect(providerAccountFailure(make())).toEqual(expect.any(String))
    })
  }

  it('keeps the provider’s own words for the operator', () => {
    expect(providerAccountFailure(credit())).toContain('credit balance is too low')
  })
})

describe('providerAccountFailure — everything that is not our account', () => {
  const notOurs: [string, () => unknown][] = [
    ['an ordinary 400 about the request', () => apiError(400, 'invalid_request_error', 'messages: roles must alternate')],
    ['413, request too large', () => apiError(413, 'request_too_large', 'Request exceeds the maximum size')],
    ['429, rate limited — already retried', () => apiError(429, 'rate_limit_error', 'Number of requests exceeded')],
    ['500, Anthropic-side error — already retried', () => apiError(500, 'api_error', 'Internal server error')],
    ['529, overloaded — already retried', () => apiError(529, 'overloaded_error', 'Overloaded')],
    ['a connection failure', () => Anthropic.APIError.generate(undefined, undefined, 'socket hang up', undefined)],
    ['a plain Error', () => new Error('credit balance is too low')],
  ]
  for (const [name, make] of notOurs) {
    it(`leaves ${name} alone`, () => {
      expect(providerAccountFailure(make())).toBeNull()
    })
  }
})

describe('failureOutcome — what a failed call records and raises', () => {
  it('records a refusal of our account at zero tokens and zero cost, and raises the retryable error', () => {
    const outcome = failureOutcome(credit(), 643)
    expect(outcome.record.usage).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
    expect(outcome.record.cost).toBe(0)
    expect(outcome.record.error.startsWith(PROVIDER_REFUSAL_MARK)).toBe(true)
    expect(outcome.record.error).toContain('credit balance is too low')
    expect(outcome.raise).toBeInstanceOf(AIProviderUnavailableError)
  })

  it('still meters an ordinary failure on its input, as before', () => {
    const outcome = failureOutcome(apiError(529, 'overloaded_error', 'Overloaded'), 643)
    expect(outcome.record.usage.inputTokens).toBe(643)
    expect(outcome.record.cost).toBeGreaterThan(0)
    expect(outcome.record.error.startsWith(PROVIDER_REFUSAL_MARK)).toBe(false)
  })

  it('keeps an ordinary 400 permanent, and a transient error as itself', () => {
    expect(failureOutcome(apiError(400, 'invalid_request_error', 'bad'), 10).raise).toBeInstanceOf(AIConfigError)
    const overloaded = apiError(529, 'overloaded_error', 'Overloaded')
    expect(failureOutcome(overloaded, 10).raise).toBe(overloaded)
  })
})

describe('what the customer reads', () => {
  it('never carries the provider’s words, or an instruction meant for us', () => {
    const shown = new AIProviderUnavailableError(CREDIT_TEXT).message
    expect(shown).toBe(AI_PROVIDER_UNAVAILABLE_MESSAGE)
    for (const leak of ['Plans & Billing', 'credit', 'ANTHROPIC_API_KEY', 'Vercel', 'Anthropic']) {
      expect(shown).not.toContain(leak)
    }
  })

  it('makes no promise of a retry, because a test run never retries', () => {
    expect(AI_PROVIDER_UNAVAILABLE_MESSAGE).not.toMatch(/retr/i)
  })
})

describe('runAIStep with no API key configured', () => {
  it('refuses as ours, and records a zero-cost row the operator alert can see', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')

    await expect(
      runAIStep({
        customerId: 'cust_1',
        workflowId: 'wf_1',
        task: 'draft_followup',
        facts: { dealName: 'Acme', stage: 'closedwon', owner: 'Jane', triggerDescription: 'test' },
      })
    ).rejects.toBeInstanceOf(AIProviderUnavailableError)

    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ table: 'ai_usage', cost_usd: 0, input_tokens: 0, succeeded: false })
    expect(String(inserted[0].error_message)).toMatch(new RegExp(`^${PROVIDER_REFUSAL_MARK}.*ANTHROPIC_API_KEY`))
  })
})
