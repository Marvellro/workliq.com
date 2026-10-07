import type { WorkflowRow } from './workflow-engine'

// The step model.
//
// A workflow used to have one action. The ai_step action already worked around
// that with a `deliver_to` field — a hard-coded second step available to one
// action type only — which is what a single-action model looks like when it has
// run out of room.
//
// Steps are stored as an ordered array on the workflow rather than in their own
// table. They are always read as a whole with the workflow and never queried
// independently, ordering is inherent in the array, and it keeps the execution
// path to a single row read.

export const ACTION_TYPES = ['slack_message', 'notion_row', 'webhook', 'ai_step'] as const
export type ActionType = (typeof ACTION_TYPES)[number]

export type StepConfig = {
  message_template?: string
  url?: string
  ai_task?: 'summarize' | 'draft_followup' | 'score_lead' | 'next_action'
  ai_instructions?: string
  /**
   * Legacy, ai_step only: deliver the generated text through this channel as
   * part of the same step.
   *
   * Honoured only when explicitly present. Every workflow written before 016
   * carries it, so leaving it meaningful keeps those working unchanged. New
   * workflows express delivery as its own step instead, which is the whole
   * point of steps existing — and an ai_step with no `deliver_to` simply
   * produces text for a later step to use.
   */
  deliver_to?: 'slack_message' | 'notion_row'
}

export type WorkflowStep = {
  action_type: ActionType
  action_config: StepConfig
}

/**
 * Upper bound on steps.
 *
 * A safety rail against absurd configurations, not a plan lever — what a given
 * plan may *do* in a step is decided by checkActionAllowed, per step. Mirrored
 * by a check constraint in 016 so the rule holds even if a write bypasses the
 * API.
 */
export const MAX_STEPS = 10

export function isActionType(value: unknown): value is ActionType {
  return typeof value === 'string' && (ACTION_TYPES as readonly string[]).includes(value)
}

/**
 * The steps a workflow should run.
 *
 * Falls back to the legacy single-action columns when `steps` is absent. 016
 * backfills every existing row, so the fallback should never fire — it exists
 * because this function runs on the delivery path, and silently doing nothing
 * because of an unexpected shape is the failure mode this codebase keeps
 * finding. A workflow with no steps at all is a configuration error worth
 * raising, which the caller does.
 */
export function stepsFor(workflow: WorkflowRow): WorkflowStep[] {
  const raw = (workflow as { steps?: unknown }).steps

  if (Array.isArray(raw) && raw.length > 0) {
    return raw.filter(isStepShaped)
  }

  if (workflow.action_type) {
    return [
      {
        action_type: workflow.action_type as ActionType,
        action_config: (workflow.action_config ?? {}) as StepConfig,
      },
    ]
  }

  return []
}

function isStepShaped(value: unknown): value is WorkflowStep {
  if (!value || typeof value !== 'object') return false
  const s = value as Record<string, unknown>
  return isActionType(s.action_type) && (s.action_config === undefined || typeof s.action_config === 'object')
}

// ── Templates ────────────────────────────────────────────────────────────────

/**
 * `{{step1}}` … `{{stepN}}`, one-indexed to match how steps are numbered on
 * screen. Referencing a step is what makes "draft with AI, then post it to
 * Slack" expressible as two steps rather than one action with a delivery
 * setting bolted on.
 */
const STEP_REF = /\{\{\s*step(\d+)\s*\}\}/g

export type TemplateFacts = {
  dealName: string
  stage: string
  owner: string
  link: string
}

/**
 * Fills a step's template.
 *
 * `outputs` is indexed by step position; a step may only reference earlier
 * ones, which `validateSteps` enforces at save time. An out-of-range or
 * empty reference renders as an empty string rather than leaving the literal
 * `{{step2}}` in a customer-facing message — by the time text is being sent,
 * showing the placeholder is worse than showing nothing.
 */
export function fillTemplate(
  template: string,
  facts: TemplateFacts,
  outputs: (string | null)[] = []
): string {
  return template
    .replaceAll('{{deal_name}}', facts.dealName)
    .replaceAll('{{stage}}', facts.stage)
    .replaceAll('{{owner}}', facts.owner)
    .replaceAll('{{link}}', facts.link)
    .replace(STEP_REF, (_match, n: string) => outputs[Number(n) - 1] ?? '')
}

/** Step numbers a template refers to, one-indexed. */
export function stepRefsIn(template: string): number[] {
  const found: number[] = []
  for (const m of template.matchAll(STEP_REF)) found.push(Number(m[1]))
  return found
}

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Checks a step list before it is saved.
 *
 * Returns a customer-facing message, or null when the list is fine. Shape
 * validation only — anything needing network access (resolving a webhook host)
 * stays at the API boundary where it already lives.
 */
export function validateSteps(steps: unknown): string | null {
  if (!Array.isArray(steps) || steps.length === 0) {
    return 'A workflow needs at least one step'
  }
  if (steps.length > MAX_STEPS) {
    return `A workflow can have at most ${MAX_STEPS} steps`
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as Record<string, unknown> | null
    const position = i + 1

    if (!step || typeof step !== 'object') {
      return `Step ${position} is not valid`
    }
    if (!isActionType(step.action_type)) {
      return `Step ${position} has an unknown action type`
    }

    const config = (step.action_config ?? {}) as StepConfig
    if (typeof config !== 'object') {
      return `Step ${position} has an invalid configuration`
    }

    if (step.action_type === 'ai_step' && !config.ai_task) {
      return `Step ${position} is an AI step with no task chosen`
    }
    if (step.action_type === 'webhook' && typeof config.url !== 'string') {
      return `Step ${position} is a webhook with no URL`
    }

    // A step may only use output from steps that have already run. Forward and
    // self references are caught here rather than rendering as empty at
    // delivery time, where the customer would see a message quietly missing the
    // part they built the workflow for.
    const template = typeof config.message_template === 'string' ? config.message_template : ''
    for (const ref of stepRefsIn(template)) {
      if (ref < 1 || ref > steps.length) {
        return `Step ${position} refers to step ${ref}, which does not exist`
      }
      if (ref >= position) {
        return `Step ${position} refers to step ${ref}, which runs later — a step can only use output from earlier steps`
      }
    }
  }

  return null
}

/** Human label for a step, used in the activity feed and the builder. */
export const ACTION_LABELS: Record<ActionType, string> = {
  slack_message: 'Send a Slack message',
  notion_row: 'Add a Notion row',
  webhook: 'Call a webhook',
  ai_step: 'Run an AI step',
}
