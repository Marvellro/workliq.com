import { describe, it, expect } from 'vitest'
import { simulateTrigger, summarizeTestRun, OUTPUT_PREVIEW_CHARS } from '../workflow-test'
import type { WorkflowRow } from '../workflow-engine'
import type { HubSpotDeal } from '../hubspot-deals'
import type { WorkflowStep } from '../workflow-steps'

// "Send a test" simulates a workflow's trigger happening to a real deal. What
// it is allowed to invent, and what it must report having invented, is decided
// in simulateTrigger; how a run is reported back is decided in
// summarizeTestRun. Both are pure, so the rules are pinned here without
// HubSpot or a database.

const NOW = Date.UTC(2026, 9, 13, 12, 0, 0)
const DAY = 24 * 60 * 60 * 1000
const FP = 'test:00000000-0000-4000-8000-000000000000'

function workflow(over: Partial<WorkflowRow> = {}): WorkflowRow {
  return {
    id: 'wf_1',
    name: 'Test workflow',
    trigger_type: 'deal_created',
    trigger_config: {},
    condition_property: null,
    condition_operator: null,
    condition_value: null,
    steps: [{ action_type: 'slack_message', action_config: {} }],
    action_type: null,
    action_config: null,
    enabled: true,
    ...over,
  }
}

function deal(props: Partial<HubSpotDeal['properties']> = {}): HubSpotDeal {
  return {
    id: '1234567',
    properties: {
      dealname: 'Acme renewal',
      dealstage: 'appointmentscheduled',
      hubspot_owner_id: '77',
      notes_last_updated: new Date(NOW - 20 * DAY).toISOString(),
      ...props,
    },
  }
}

const owners = new Map([['77', 'Jane Doe']])

function sim(w: WorkflowRow, d: HubSpotDeal = deal()) {
  return simulateTrigger({ workflow: w, deal: d, ownerMap: owners, fingerprint: FP, now: NOW })
}

describe('simulateTrigger — the event', () => {
  it('carries the test fingerprint it was given, unchanged', () => {
    expect(sim(workflow()).event.fingerprint).toBe(FP)
  })

  it('invents nothing for a deal-created workflow', () => {
    const s = sim(workflow({ trigger_type: 'deal_created' }))
    expect(s.event).toEqual({ type: 'deal_created', fingerprint: FP })
    expect(s.dealStage).toBe('appointmentscheduled')
    expect(s.simulated).toEqual([])
  })
})

describe('simulateTrigger — stage changes', () => {
  it('simulates the move into the configured stage, and says it did', () => {
    const s = sim(workflow({ trigger_type: 'deal_stage_changed', trigger_config: { to_stage: 'closedwon' } }))
    expect(s.event).toMatchObject({ type: 'deal_stage_changed', newStage: 'closedwon' })
    expect(s.dealStage).toBe('closedwon')
    expect(s.simulated).toHaveLength(1)
    expect(s.simulated[0]).toContain('closedwon')
    expect(s.simulated[0]).toContain('appointmentscheduled') // where the deal really is
  })

  it('invents nothing when the deal is already in the configured stage', () => {
    const s = sim(
      workflow({ trigger_type: 'deal_stage_changed', trigger_config: { to_stage: 'closedwon' } }),
      deal({ dealstage: 'closedwon' })
    )
    expect(s.simulated).toEqual([])
  })

  it('uses the deal’s own stage when the workflow fires on any move', () => {
    const s = sim(workflow({ trigger_type: 'deal_stage_changed', trigger_config: {} }))
    expect(s.event).toMatchObject({ newStage: 'appointmentscheduled' })
    expect(s.simulated).toEqual([])
  })
})

describe('simulateTrigger — staleness', () => {
  const stale = (threshold: number) =>
    workflow({ trigger_type: 'deal_stale', trigger_config: { threshold_days: threshold } })

  it('uses the deal’s real age when it is already past the threshold', () => {
    const s = sim(stale(14), deal({ notes_last_updated: new Date(NOW - 20 * DAY).toISOString() }))
    expect(s.event).toMatchObject({ type: 'deal_stale', thresholdDays: 14, daysStale: 20 })
    expect(s.simulated).toEqual([])
  })

  it('simulates the threshold when the deal is younger, and reports its real age', () => {
    const s = sim(stale(14), deal({ notes_last_updated: new Date(NOW - 3 * DAY).toISOString() }))
    expect(s.event).toMatchObject({ daysStale: 14 })
    expect(s.simulated[0]).toContain('3 days ago')
  })

  it('says so when no activity has ever been logged', () => {
    const s = sim(stale(14), deal({ notes_last_updated: null }))
    expect(s.event).toMatchObject({ daysStale: 14 })
    expect(s.simulated[0]).toMatch(/no activity has ever been logged/i)
  })

  it('never reports a deal as stale for less than the threshold', () => {
    // The live wording sent to Slack and to the model says "past the N-day
    // threshold". A test must not make that sentence false.
    for (const ago of [0, 1, 13, 14, 15, 400]) {
      const s = sim(stale(14), deal({ notes_last_updated: new Date(NOW - ago * DAY).toISOString() }))
      if (s.event.type !== 'deal_stale') throw new Error('expected a staleness event')
      expect(s.event.daysStale).toBeGreaterThanOrEqual(s.event.thresholdDays)
    }
  })
})

describe('simulateTrigger — the workflow’s condition', () => {
  it('stays quiet when there is no condition', () => {
    expect(sim(workflow()).conditionNote).toBeNull()
  })

  it('stays quiet when the deal meets the condition', () => {
    const w = workflow({ condition_property: 'hubspot_owner_id', condition_operator: 'equals', condition_value: 'Jane Doe' })
    expect(sim(w).conditionNote).toBeNull()
  })

  it('explains, with the deal’s real value, when a real event would not run it', () => {
    const w = workflow({ condition_property: 'hubspot_owner_id', condition_operator: 'equals', condition_value: 'Sam Lee' })
    const note = sim(w).conditionNote
    expect(note).toContain('owner is "Sam Lee"')
    expect(note).toContain('"Jane Doe"')
    expect(note).toMatch(/would not run it/)
  })

  it('judges a stage condition against the stage the trigger moved the deal into', () => {
    // As a real event would: by the time it runs, the stage has changed.
    const w = workflow({
      trigger_type: 'deal_stage_changed',
      trigger_config: { to_stage: 'closedwon' },
      condition_property: 'dealstage',
      condition_operator: 'equals',
      condition_value: 'closedwon',
    })
    expect(sim(w).conditionNote).toBeNull()
  })
})

describe('summarizeTestRun', () => {
  const steps: WorkflowStep[] = [
    { action_type: 'ai_step', action_config: { ai_task: 'summarize' } },
    { action_type: 'slack_message', action_config: {} },
    { action_type: 'webhook', action_config: { url: 'https://example.com/h' } },
  ]
  const row = (step_index: number, status: string, extra: Partial<{ output: string; error_message: string }> = {}) => ({
    step_index,
    status,
    output: extra.output ?? null,
    error_message: extra.error_message ?? null,
  })

  it('reports every step done when every row succeeded', () => {
    const r = summarizeTestRun(steps, [row(0, 'success', { output: 'summary' }), row(1, 'success'), row(2, 'success')])
    expect(r.map((s) => s.status)).toEqual(['success', 'success', 'success'])
    expect(r[0].output).toBe('summary')
  })

  it('stops at the first failure: later steps were never started', () => {
    const r = summarizeTestRun(steps, [
      row(0, 'success'),
      row(1, 'failed', { error_message: 'Step 2 (Send a Slack message): channel_not_found' }),
    ])
    expect(r.map((s) => s.status)).toEqual(['success', 'failed', 'not_run'])
    expect(r[1].error).toContain('channel_not_found')
    expect(r[2].error).toBeNull()
  })

  it('reports no rows as nothing having run', () => {
    expect(summarizeTestRun(steps, []).map((s) => s.status)).toEqual(['not_run', 'not_run', 'not_run'])
  })

  it('reports a claimed-but-unfinished step as failed, not as still going', () => {
    const r = summarizeTestRun(steps, [row(0, 'pending')])
    expect(r[0]).toMatchObject({ status: 'failed', error: 'This step did not finish.' })
  })

  it('caps the output it shows', () => {
    const r = summarizeTestRun(steps, [row(0, 'success', { output: 'x'.repeat(OUTPUT_PREVIEW_CHARS + 500) })])
    expect(r[0].output).toHaveLength(OUTPUT_PREVIEW_CHARS)
  })
})
