import { describe, it, expect } from 'vitest'
import {
  stepsFor,
  fillTemplate,
  stepRefsIn,
  validateSteps,
  MAX_STEPS,
  type WorkflowStep,
} from '../workflow-steps'
import type { WorkflowRow } from '../workflow-engine'

const FACTS = {
  dealName: 'Acme renewal',
  stage: 'Contract sent',
  owner: 'Dana',
  link: 'https://app.hubspot.com/contacts/1/deal/9',
}

function workflow(over: Partial<WorkflowRow> = {}): WorkflowRow {
  return {
    id: 'w-1',
    name: 'Test',
    trigger_type: 'deal_created',
    trigger_config: {},
    condition_property: null,
    condition_operator: null,
    condition_value: null,
    steps: [],
    action_type: null,
    action_config: null,
    enabled: true,
    ...over,
  } as WorkflowRow
}

function step(action_type: WorkflowStep['action_type'], action_config = {}): WorkflowStep {
  return { action_type, action_config }
}

describe('stepsFor', () => {
  it('reads the steps array', () => {
    const w = workflow({ steps: [step('ai_step', { ai_task: 'summarize' }), step('slack_message')] })
    expect(stepsFor(w).map((s) => s.action_type)).toEqual(['ai_step', 'slack_message'])
  })

  it('falls back to the legacy single action', () => {
    // 016 backfills every row, so this should never fire in production. It
    // exists because this runs on the delivery path, and quietly doing nothing
    // because of an unexpected shape is the failure mode this codebase keeps
    // finding.
    const w = workflow({ action_type: 'slack_message', action_config: { message_template: 'hi' } })
    expect(stepsFor(w)).toEqual([
      { action_type: 'slack_message', action_config: { message_template: 'hi' } },
    ])
  })

  it('prefers steps over the legacy columns when both exist', () => {
    const w = workflow({
      steps: [step('notion_row')],
      action_type: 'slack_message',
      action_config: {},
    })
    expect(stepsFor(w).map((s) => s.action_type)).toEqual(['notion_row'])
  })

  it('returns nothing when there is nothing to run', () => {
    // The caller raises on this rather than treating it as a no-op success.
    expect(stepsFor(workflow())).toEqual([])
  })

  it('drops entries that are not steps', () => {
    const w = workflow({ steps: [step('slack_message'), null, { nope: true }] as never })
    expect(stepsFor(w)).toHaveLength(1)
  })
})

describe('fillTemplate', () => {
  it('fills the deal facts', () => {
    expect(fillTemplate('{{deal_name}} / {{stage}} / {{owner}} / {{link}}', FACTS)).toBe(
      'Acme renewal / Contract sent / Dana / https://app.hubspot.com/contacts/1/deal/9'
    )
  })

  it('fills a reference to an earlier step', () => {
    // The headline capability: draft with AI, then post that draft.
    expect(fillTemplate('Draft:\n{{step1}}', FACTS, ['Hi Dana, following up…'])).toBe(
      'Draft:\nHi Dana, following up…'
    )
  })

  it('renders an unavailable reference as nothing, not as the placeholder', () => {
    // By the time text is being sent, a literal {{step2}} in a customer-facing
    // Slack message is worse than a gap.
    expect(fillTemplate('[{{step2}}]', FACTS, ['only one'])).toBe('[]')
    expect(fillTemplate('[{{step1}}]', FACTS, [null])).toBe('[]')
    expect(fillTemplate('[{{step1}}]', FACTS)).toBe('[]')
  })

  it('tolerates whitespace in the reference', () => {
    expect(fillTemplate('{{ step1 }}', FACTS, ['x'])).toBe('x')
  })

  it('replaces every occurrence', () => {
    expect(fillTemplate('{{owner}} and {{owner}}', FACTS)).toBe('Dana and Dana')
    expect(fillTemplate('{{step1}}{{step1}}', FACTS, ['a'])).toBe('aa')
  })
})

describe('stepRefsIn', () => {
  it('finds the step numbers used', () => {
    expect(stepRefsIn('{{step1}} then {{step3}}')).toEqual([1, 3])
    expect(stepRefsIn('no refs here {{owner}}')).toEqual([])
  })
})

describe('validateSteps', () => {
  it('accepts a valid list', () => {
    expect(
      validateSteps([
        step('ai_step', { ai_task: 'draft_followup' }),
        step('slack_message', { message_template: 'Draft: {{step1}}' }),
      ])
    ).toBeNull()
  })

  it('requires at least one step', () => {
    expect(validateSteps([])).toMatch(/at least one step/)
    expect(validateSteps(null)).toMatch(/at least one step/)
    expect(validateSteps('nope')).toMatch(/at least one step/)
  })

  it('caps the number of steps', () => {
    const many = Array.from({ length: MAX_STEPS + 1 }, () => step('slack_message'))
    expect(validateSteps(many)).toMatch(new RegExp(`at most ${MAX_STEPS} steps`))
    expect(validateSteps(many.slice(0, MAX_STEPS))).toBeNull()
  })

  it('rejects an unknown action type', () => {
    expect(validateSteps([{ action_type: 'send_pigeon', action_config: {} }])).toMatch(
      /Step 1 has an unknown action type/
    )
  })

  it('requires an AI step to have a task', () => {
    expect(validateSteps([step('ai_step')])).toMatch(/Step 1 is an AI step with no task/)
  })

  it('requires a webhook step to have a URL', () => {
    expect(validateSteps([step('webhook')])).toMatch(/Step 1 is a webhook with no URL/)
  })

  it('rejects a reference to a later step', () => {
    // Caught at save time rather than rendering as a silent gap at delivery
    // time, where the customer would get a message missing the part they built
    // the workflow for.
    const result = validateSteps([
      step('slack_message', { message_template: 'Draft: {{step2}}' }),
      step('ai_step', { ai_task: 'summarize' }),
    ])
    expect(result).toMatch(/runs later/)
  })

  it('rejects a step referring to itself', () => {
    expect(
      validateSteps([step('slack_message', { message_template: '{{step1}}' })])
    ).toMatch(/runs later/)
  })

  it('rejects a reference to a step that does not exist', () => {
    expect(
      validateSteps([
        step('ai_step', { ai_task: 'summarize' }),
        step('slack_message', { message_template: '{{step9}}' }),
      ])
    ).toMatch(/does not exist/)
  })

  it('names the position of the bad step', () => {
    // With up to ten steps, "invalid configuration" without a number is not
    // something a customer can act on.
    expect(validateSteps([step('slack_message'), step('ai_step')])).toMatch(/Step 2/)
  })
})
