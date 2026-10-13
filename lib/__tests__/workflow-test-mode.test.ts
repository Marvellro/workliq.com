import { describe, it, expect, vi, beforeEach } from 'vitest'

// Test mode runs through the live execution path, so the rules that keep the
// two apart live in that path too. These pin them:
//
//   - a test may only be recorded under a test fingerprint, and a live run
//     never under one — the guard that stops a test eating a real alert;
//   - a switched-off workflow can be tested, but not run live;
//   - every delivery is marked in test mode, and identical to before in live
//     mode — an existing integration must not see a changed payload;
//   - Activity names a test run as a test, not as the event it imitates.

const { getSupabaseAdmin } = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }))

vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  getSupabaseAdmin,
}))

import {
  executeWorkflowAction,
  markSlackText,
  markTitle,
  webhookBody,
  type ActionPayload,
} from '../workflow-execute'
import { PermanentJobError } from '../jobs'
import { isTestFingerprint } from '../test-fingerprint'
import { describeTrigger } from '../run-labels'

const TEST_FP = 'test:00000000-0000-4000-8000-000000000000'

function payload(fingerprint: string): ActionPayload {
  return {
    workflowId: 'wf_1',
    customerId: 'cust_1',
    hubId: '148743548',
    dealId: '1234567',
    dealName: 'Acme renewal',
    dealStage: 'closedwon',
    ownerName: 'Jane Doe',
    event: { type: 'deal_created', fingerprint },
  }
}

/**
 * A database holding one workflow, where claiming a step always fails. A run
 * that gets as far as claiming has passed every check before delivery, and
 * stops there — so these tests can tell "refused" from "allowed" without
 * anything ever being sent.
 */
function databaseWith(workflow: Record<string, unknown>) {
  return {
    from(table: string) {
      if (table === 'workflows') {
        const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: workflow, error: null }) }
        return q
      }
      if (table === 'workflow_runs') {
        const q = { upsert: () => q, select: () => q, single: async () => ({ data: null, error: { message: 'claim reached' } }) }
        return q
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

const disabledWorkflow = {
  id: 'wf_1',
  name: 'Switched off',
  enabled: false,
  steps: [{ action_type: 'slack_message', action_config: {} }],
}

beforeEach(() => {
  getSupabaseAdmin.mockReset()
  getSupabaseAdmin.mockImplementation(() => {
    throw new Error('the database was touched')
  })
})

describe('the fingerprint and the mode must agree', () => {
  it('refuses a test recorded under a real event’s fingerprint, before touching anything', async () => {
    await expect(executeWorkflowAction(payload('1234567'), { test: true })).rejects.toBeInstanceOf(PermanentJobError)
    expect(getSupabaseAdmin).not.toHaveBeenCalled()
  })

  it('refuses a live run recorded under a test fingerprint, before touching anything', async () => {
    await expect(executeWorkflowAction(payload(TEST_FP))).rejects.toBeInstanceOf(PermanentJobError)
    expect(getSupabaseAdmin).not.toHaveBeenCalled()
  })

  it('tells test fingerprints from every shape of real one', () => {
    expect(isTestFingerprint(TEST_FP)).toBe(true)
    for (const real of ['1234567', '1234567:closedwon', '1234567:14']) {
      expect(isTestFingerprint(real)).toBe(false)
    }
  })
})

describe('a switched-off workflow', () => {
  it('is not run live', async () => {
    getSupabaseAdmin.mockReturnValue(databaseWith(disabledWorkflow))
    await expect(executeWorkflowAction(payload('1234567'))).rejects.toThrow(/is disabled/)
  })

  it('can be tested — the run gets past the check and as far as claiming its first step', async () => {
    getSupabaseAdmin.mockReturnValue(databaseWith(disabledWorkflow))
    await expect(executeWorkflowAction(payload(TEST_FP), { test: true })).rejects.toThrow(
      /Could not claim step 1: claim reached/
    )
  })
})

describe('deliveries are marked in test mode and untouched in live mode', () => {
  it('heads a Slack message in a test, and leaves a live one exactly as it was', () => {
    expect(markSlackText('Deal moved', true)).toMatch(/^🧪 \*Test run\*.*\nDeal moved$/)
    expect(markSlackText('Deal moved', false)).toBe('Deal moved')
  })

  it('prefixes a Notion title in a test, and leaves a live one exactly as it was', () => {
    expect(markTitle('Acme renewal', true)).toBe('[Test] Acme renewal')
    expect(markTitle('Acme renewal', false)).toBe('Acme renewal')
  })

  const args = {
    workflow: { id: 'wf_1', name: 'Hook' },
    payload: payload('1234567'),
    facts: { dealName: 'Acme renewal', stage: 'closedwon', owner: 'Jane Doe', link: 'https://app.hubspot.com/x' },
    outputs: ['summary'],
  }

  it('adds test: true to a test webhook’s body, where the signature covers it', () => {
    expect(webhookBody({ ...args, test: true })).toMatchObject({ test: true })
  })

  it('leaves a live webhook body without any test field at all', () => {
    // Not test: false — absent. An integration validating the payload strictly
    // must see exactly what it saw before this feature existed.
    const live = webhookBody({ ...args, test: false })
    expect('test' in live).toBe(false)
    expect(Object.keys(live).sort()).toEqual(
      ['deal_id', 'deal_name', 'hubspot_link', 'owner', 'stage', 'steps', 'trigger', 'workflow_id', 'workflow_name']
    )
  })
})

describe('Activity names a test run as a test', () => {
  it('labels a test fingerprint "Test run", not the event it imitates', () => {
    expect(describeTrigger(TEST_FP, '1234567')).toBe('Test run')
  })

  it('still describes real events as before', () => {
    expect(describeTrigger('1234567', '1234567')).toBe('Deal created')
    expect(describeTrigger('1234567:closedwon', '1234567')).toBe('Moved to closedwon')
    expect(describeTrigger('1234567:14', '1234567')).toBe('Stale 14+ days')
  })
})
