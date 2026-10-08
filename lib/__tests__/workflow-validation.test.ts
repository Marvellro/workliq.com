import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BlockedAddressError } from '../safe-fetch'
import { PLANS } from '../plans'

// validateWebhookUrl resolves DNS, which a unit test must not do. Only the
// network call is replaced; every decision under test is the real one.
const validateWebhookUrl = vi.fn<(url: string) => Promise<void>>()
vi.mock('../safe-fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../safe-fetch')>()
  return { ...actual, validateWebhookUrl: (url: string) => validateWebhookUrl(url) }
})

const { validateWorkflowInput, stepsFromBody } = await import('../workflow-validation')

beforeEach(() => {
  validateWebhookUrl.mockReset()
  validateWebhookUrl.mockResolvedValue(undefined)
})

function input(over: Record<string, unknown> = {}) {
  return {
    name: 'Test workflow',
    trigger_type: 'deal_created',
    trigger_config: {},
    condition_property: null,
    condition_operator: null,
    steps: [{ action_type: 'slack_message' as const, action_config: {} }],
    ...over,
  }
}

// This validator is shared by creating and editing. That is the point of it
// existing: a rule enforced on create and not on edit is not a rule, and the
// edit path becomes the documented way around every check below.

describe('validateWorkflowInput', () => {
  it('accepts a valid workflow', async () => {
    expect(await validateWorkflowInput(input(), PLANS.growth)).toBeNull()
  })

  it('requires a name', async () => {
    expect((await validateWorkflowInput(input({ name: '   ' }), PLANS.growth))?.error).toMatch(/name/)
    expect((await validateWorkflowInput(input({ name: 42 }), PLANS.growth))?.error).toMatch(/name/)
  })

  it('rejects unknown triggers, operators and properties', async () => {
    expect(await validateWorkflowInput(input({ trigger_type: 'deal_exploded' }), PLANS.growth)).not.toBeNull()
    expect(
      await validateWorkflowInput(input({ condition_operator: 'sort_of' }), PLANS.growth)
    ).not.toBeNull()
    // An unrecognised property resolves to null at run time, which makes
    // not_equals match every deal. Rejecting it here keeps that out of reach.
    expect(
      await validateWorkflowInput(input({ condition_property: 'amount' }), PLANS.growth)
    ).not.toBeNull()
  })

  it('requires a positive threshold for a staleness trigger', async () => {
    for (const threshold_days of [undefined, 0, -3, 'seven']) {
      const result = await validateWorkflowInput(
        input({ trigger_type: 'deal_stale', trigger_config: { threshold_days } }),
        PLANS.growth
      )
      expect(result?.error).toMatch(/threshold_days/)
    }
    expect(
      await validateWorkflowInput(
        input({ trigger_type: 'deal_stale', trigger_config: { threshold_days: 7 } }),
        PLANS.growth
      )
    ).toBeNull()
  })

  it('rejects a webhook step pointing somewhere internal', async () => {
    // The real SSRF guard runs on every delivery; this is the save-time check
    // that gives immediate feedback. It has to apply when editing too,
    // otherwise create-clean-then-edit-to-metadata is an open door.
    validateWebhookUrl.mockRejectedValue(new BlockedAddressError('resolves to a private address'))
    const result = await validateWorkflowInput(
      input({ steps: [{ action_type: 'webhook', action_config: { url: 'https://169.254.169.254' } }] }),
      PLANS.growth
    )
    expect(result?.status).toBe(400)
    expect(result?.error).toMatch(/Step 1: .*private address/)
  })

  it('gates every step against the plan, not just the first', async () => {
    // A free account putting a Slack step in front of an AI step must not have
    // the whole workflow waved through on the strength of step one.
    const result = await validateWorkflowInput(
      input({
        steps: [
          { action_type: 'slack_message', action_config: {} },
          { action_type: 'ai_step', action_config: { ai_task: 'summarize' } },
        ],
      }),
      PLANS.free
    )
    expect(result?.status).toBe(402)
    expect(result?.error).toMatch(/^Step 2:/)
  })

  it('allows those same steps on a paid plan', async () => {
    expect(
      await validateWorkflowInput(
        input({
          steps: [
            { action_type: 'ai_step', action_config: { ai_task: 'summarize' } },
            { action_type: 'slack_message', action_config: { message_template: '{{step1}}' } },
          ],
        }),
        PLANS.starter
      )
    ).toBeNull()
  })

  it('bounds the AI instruction length', async () => {
    const result = await validateWorkflowInput(
      input({
        steps: [
          { action_type: 'ai_step', action_config: { ai_task: 'summarize', ai_instructions: 'x'.repeat(501) } },
          { action_type: 'slack_message', action_config: { message_template: '{{step1}}' } },
        ],
      }),
      PLANS.growth
    )
    // Free text forwarded to the model on our API key, so it is bounded.
    expect(result?.error).toMatch(/under 500 characters/)
  })

  it('delegates step shape, and names the position', async () => {
    const result = await validateWorkflowInput(
      input({ steps: [{ action_type: 'ai_step', action_config: {} }] }),
      PLANS.growth
    )
    expect(result?.error).toMatch(/Step 1/)
  })
})

describe('stepsFromBody', () => {
  it('passes a steps array through', () => {
    const steps = [{ action_type: 'notion_row' as const, action_config: {} }]
    expect(stepsFromBody({ steps })).toEqual(steps)
  })

  it('accepts the pre-016 single-action shape', () => {
    // Anything written against the old API keeps working: it is simply a
    // one-step workflow, which is what it always was.
    expect(stepsFromBody({ action_type: 'slack_message', action_config: { message_template: 'hi' } })).toEqual([
      { action_type: 'slack_message', action_config: { message_template: 'hi' } },
    ])
  })
})
