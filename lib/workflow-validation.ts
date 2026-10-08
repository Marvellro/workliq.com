import { validateWebhookUrl, BlockedAddressError } from './safe-fetch'
import { checkActionAllowed, type Entitlements } from './plans'
import { validateSteps, type WorkflowStep } from './workflow-steps'

// Validation shared by creating and editing a workflow.
//
// Extracted because the two paths have to agree. A rule enforced when a
// workflow is created and not when it is edited is not a rule — it is a
// speed bump, and the edit path becomes the way around every one of these: the
// SSRF check on webhook targets, the per-step plan gate, the step shape.

export const TRIGGER_TYPES = ['deal_stage_changed', 'deal_created', 'deal_stale'] as const
export const ACTION_TYPES = ['slack_message', 'notion_row', 'webhook', 'ai_step'] as const
export const AI_TASKS = ['summarize', 'draft_followup', 'score_lead', 'next_action'] as const
export const AI_DELIVERY = ['slack_message', 'notion_row'] as const
export const CONDITION_OPERATORS = ['equals', 'not_equals', 'contains'] as const

// Must match the properties workflow-engine.ts's getDealPropertyValue() knows
// how to read. An unrecognised property always resolves to null, which makes
// 'not_equals' silently match every deal — validating at write time keeps that
// failure mode out of reach.
export const CONDITION_PROPERTIES = ['dealstage', 'dealname', 'hubspot_owner_id'] as const

// Free-text guidance is forwarded to the model. Bounded so a workflow cannot be
// used to push an arbitrarily large prompt through our API key.
export const MAX_AI_INSTRUCTIONS = 500

export type WorkflowInput = {
  name?: unknown
  trigger_type?: unknown
  trigger_config?: { to_stage?: string; threshold_days?: number } | null
  condition_property?: unknown
  condition_operator?: unknown
  condition_value?: unknown
  steps: WorkflowStep[]
}

export type ValidationFailure = { error: string; status: number }

function fail(error: string, status = 400): ValidationFailure {
  return { error, status }
}

/**
 * Checks a workflow a customer is trying to save.
 *
 * Returns null when it is acceptable, or the message and status to send back.
 * Async because the webhook check resolves DNS.
 */
export async function validateWorkflowInput(
  input: WorkflowInput,
  entitlements: Entitlements
): Promise<ValidationFailure | null> {
  const { name, trigger_type, trigger_config, condition_property, condition_operator } = input

  if (typeof name !== 'string' || !name.trim()) {
    return fail('name is required')
  }
  if (!(TRIGGER_TYPES as readonly unknown[]).includes(trigger_type)) {
    return fail('Invalid trigger_type')
  }
  if (condition_operator && !(CONDITION_OPERATORS as readonly unknown[]).includes(condition_operator)) {
    return fail('Invalid condition_operator')
  }
  if (condition_property && !(CONDITION_PROPERTIES as readonly unknown[]).includes(condition_property)) {
    return fail('Invalid condition_property')
  }
  if (trigger_type === 'deal_stale') {
    const threshold = trigger_config?.threshold_days
    if (typeof threshold !== 'number' || threshold <= 0) {
      return fail('deal_stale requires trigger_config.threshold_days')
    }
  }

  // Shape first, in one place, so every rule reads the same whether a workflow
  // has one step or ten.
  const shapeError = validateSteps(input.steps)
  if (shapeError) return fail(shapeError)

  for (let i = 0; i < input.steps.length; i++) {
    const step = input.steps[i]
    const config = step.action_config ?? {}
    const position = i + 1

    if (!(ACTION_TYPES as readonly unknown[]).includes(step.action_type)) {
      return fail(`Step ${position} has an invalid action type`)
    }

    if (step.action_type === 'ai_step') {
      if (!(AI_TASKS as readonly unknown[]).includes(config.ai_task)) {
        return fail(`Step ${position}: an AI step needs a task (${AI_TASKS.join(' | ')})`)
      }
      if (config.deliver_to && !(AI_DELIVERY as readonly unknown[]).includes(config.deliver_to)) {
        return fail(`Step ${position}: deliver_to must be one of ${AI_DELIVERY.join(' | ')}`)
      }
      const instructions = config.ai_instructions
      if (instructions !== undefined && instructions !== null) {
        if (typeof instructions !== 'string' || instructions.length > MAX_AI_INSTRUCTIONS) {
          return fail(
            `Step ${position}: instructions must be text under ${MAX_AI_INSTRUCTIONS} characters`
          )
        }
      }
    }

    if (step.action_type === 'webhook') {
      const url = config.url
      if (typeof url !== 'string') return fail(`Step ${position} needs a URL`)

      // A `startsWith('https://')` check was all this used to do, which allowed
      // https://169.254.169.254 and every other internal target.
      // validateWebhookUrl resolves the host and rejects private, loopback and
      // link-local addresses.
      //
      // A save-time convenience check that gives immediate feedback; DNS can
      // change afterwards, so lib/safe-fetch.ts re-validates on every delivery.
      // That is the actual boundary.
      try {
        await validateWebhookUrl(url)
      } catch (err) {
        if (err instanceof BlockedAddressError) return fail(`Step ${position}: ${err.message}`)
        throw err
      }
    }

    // Every step is gated, not only the first. Otherwise a free account could
    // put a Slack step in front of an AI step and have the check wave the whole
    // workflow through on the strength of step one.
    const allowed = checkActionAllowed(step.action_type, entitlements)
    if (!allowed.allowed) {
      return { error: `Step ${position}: ${allowed.reason}`, status: 402 }
    }
  }

  return null
}

/** Normalises a request body into a step list, accepting the pre-016 shape. */
export function stepsFromBody(body: {
  steps?: unknown
  action_type?: unknown
  action_config?: unknown
}): WorkflowStep[] {
  if (Array.isArray(body.steps)) return body.steps as WorkflowStep[]
  return [
    {
      action_type: body.action_type as WorkflowStep['action_type'],
      action_config: (body.action_config ?? {}) as WorkflowStep['action_config'],
    },
  ]
}
