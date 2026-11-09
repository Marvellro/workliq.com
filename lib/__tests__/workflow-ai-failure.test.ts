import { describe, it, expect, vi, beforeEach } from 'vitest'

// How an AI step's failure leaves the execution path decides two things the
// customer lives with: whether their alert is retried or lost, and what their
// Activity page says. A refusal of our Anthropic account must come out
// retryable — it clears the moment we fix it — and must say nothing the
// customer could mistake for an instruction to them. The customer's own
// budget running out stays permanent, as before.

const { runAIStep, getSupabaseAdmin } = vi.hoisted(() => ({
  runAIStep: vi.fn(),
  getSupabaseAdmin: vi.fn(),
}))

vi.mock('../ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai')>()),
  runAIStep,
}))

vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  getSupabaseAdmin,
}))

import { executeWorkflowAction, type ActionPayload } from '../workflow-execute'
import { PermanentJobError } from '../jobs'
import { AIProviderUnavailableError, AIBudgetError, AI_PROVIDER_UNAVAILABLE_MESSAGE } from '../ai'

const payload: ActionPayload = {
  workflowId: 'wf_1',
  customerId: 'cust_1',
  hubId: '148743548',
  dealId: '1234567',
  dealName: 'Acme renewal',
  dealStage: 'closedwon',
  ownerName: 'Jane Doe',
  event: { type: 'deal_created', fingerprint: '1234567' },
}

/** One enabled AI-step workflow; claiming succeeds; step updates are captured. */
function database(updates: Record<string, unknown>[]) {
  const workflow = {
    id: 'wf_1',
    name: 'Stale deal follow-up',
    enabled: true,
    steps: [{ action_type: 'ai_step', action_config: { ai_task: 'draft_followup' } }],
  }
  return {
    from(table: string) {
      if (table === 'workflows') {
        const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: workflow, error: null }) }
        return q
      }
      if (table === 'workflow_runs') {
        return {
          upsert: () => ({
            select: () => ({ single: async () => ({ data: { id: 'run_1', status: 'pending', output: null }, error: null }) }),
          }),
          update: (row: Record<string, unknown>) => {
            updates.push(row)
            return { eq: async () => ({ error: null }) }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

let updates: Record<string, unknown>[]

beforeEach(() => {
  updates = []
  runAIStep.mockReset()
  getSupabaseAdmin.mockReturnValue(database(updates))
})

describe('an AI step refused by our own account', () => {
  it('comes out retryable, not permanent', async () => {
    runAIStep.mockRejectedValue(
      new AIProviderUnavailableError('Your credit balance is too low to access the Anthropic API.')
    )
    const outcome = executeWorkflowAction(payload)
    await expect(outcome).rejects.toBeInstanceOf(AIProviderUnavailableError)
    await expect(outcome).rejects.not.toBeInstanceOf(PermanentJobError)
  })

  it('records the customer-safe sentence on the step, not the provider’s words', async () => {
    runAIStep.mockRejectedValue(
      new AIProviderUnavailableError(
        'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'
      )
    )
    await executeWorkflowAction(payload).catch(() => {})

    const failed = updates.find((u) => u.status === 'failed')
    expect(failed?.error_message).toBe(`Step 1 (Run an AI step): ${AI_PROVIDER_UNAVAILABLE_MESSAGE}`)
    expect(String(failed?.error_message)).not.toMatch(/credit|Plans & Billing/i)
  })
})

describe('an AI step stopped by the customer’s own budget', () => {
  it('stays permanent, as before', async () => {
    runAIStep.mockRejectedValue(new AIBudgetError('Monthly AI budget reached'))
    await expect(executeWorkflowAction(payload)).rejects.toBeInstanceOf(PermanentJobError)
  })
})
