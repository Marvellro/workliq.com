import { describe, it, expect } from 'vitest'
import { providersUsedBy, missingConnectionMessage, isConnectionProvider } from '../connections'
import type { WorkflowStep } from '../workflow-steps'

// The rule three places depend on: which workflows Disconnect pauses, and what
// may be switched on or saved while something is not connected. If it misses a
// step type, Disconnect leaves a workflow running against a connection that no
// longer exists, and it fails on every deal.

const slack: WorkflowStep = { action_type: 'slack_message', action_config: {} }
const notion: WorkflowStep = { action_type: 'notion_row', action_config: {} }
const webhook: WorkflowStep = { action_type: 'webhook', action_config: { url: 'https://example.com/hook' } }
const aiOnly: WorkflowStep = { action_type: 'ai_step', action_config: { ai_task: 'summarize' } }

describe('providersUsedBy', () => {
  it('always includes HubSpot, because every trigger is a HubSpot deal', () => {
    expect(providersUsedBy([webhook])).toEqual(['hubspot'])
    expect(providersUsedBy([])).toEqual(['hubspot'])
  })

  it('names Slack and Notion when a step sends there', () => {
    expect(providersUsedBy([slack])).toEqual(['hubspot', 'slack'])
    expect(providersUsedBy([notion])).toEqual(['hubspot', 'notion'])
    expect(providersUsedBy([notion, webhook, slack])).toEqual(['hubspot', 'slack', 'notion'])
  })

  it('counts a legacy AI step that delivers its own output', () => {
    // Every workflow written before steps existed has this shape. Missing it
    // would leave them running after their destination was disconnected.
    expect(
      providersUsedBy([{ action_type: 'ai_step', action_config: { ai_task: 'summarize', deliver_to: 'slack_message' } }])
    ).toEqual(['hubspot', 'slack'])
    expect(
      providersUsedBy([{ action_type: 'ai_step', action_config: { ai_task: 'summarize', deliver_to: 'notion_row' } }])
    ).toEqual(['hubspot', 'notion'])
  })

  it('does not count an AI step that only produces text for a later step', () => {
    expect(providersUsedBy([aiOnly, webhook])).toEqual(['hubspot'])
  })

  it('tolerates a step with no configuration', () => {
    expect(
      providersUsedBy([{ action_type: 'ai_step' } as unknown as WorkflowStep])
    ).toEqual(['hubspot'])
  })
})

describe('missingConnectionMessage', () => {
  it('is null when everything needed is connected', () => {
    expect(missingConnectionMessage([slack], new Set(['hubspot', 'slack']))).toBeNull()
  })

  it('names the one that is missing', () => {
    expect(missingConnectionMessage([slack], new Set(['hubspot']))).toBe(
      'This workflow uses Slack, which is not connected. Connect Slack on the Connections page first.'
    )
  })

  it('names all of them, in a stable order', () => {
    expect(missingConnectionMessage([notion, slack], new Set())).toBe(
      'This workflow uses HubSpot, Slack and Notion, which are not connected. Connect HubSpot, Slack and Notion on the Connections page first.'
    )
  })

  it('does not ask for something the workflow does not use', () => {
    expect(missingConnectionMessage([webhook], new Set(['hubspot']))).toBeNull()
  })
})

describe('isConnectionProvider', () => {
  it('accepts exactly the three, so the route cannot be pointed at another table', () => {
    for (const p of ['hubspot', 'slack', 'notion']) expect(isConnectionProvider(p)).toBe(true)
    for (const p of ['HubSpot', 'stripe', 'customers', 'hubspot_connections', '', null, 1]) {
      expect(isConnectionProvider(p)).toBe(false)
    }
  })
})
