import { describe, it, expect, vi, afterEach } from 'vitest'

// diagnostic.noop exists because the only probe that could be planted before
// it was maintenance.purge, which deletes rows — and one purge probe, planted
// for a scheduler that ran it nine hours late, deleted a row that had crossed
// retention in the meantime. Its whole value is that planting it is safe no
// matter when it runs.
//
// That guarantee is negative ("touches nothing"), and a negative guarantee is
// easy to test in a way that proves nothing: assert a spy wasn't called, and
// the test still passes if the handler reached for the database through some
// other route. So reaching for the database here throws, and the network is
// stubbed to reject, which turns any side effect into a visible failure.

const { getSupabaseAdmin, registerHandler } = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(() => {
    throw new Error('diagnostic.noop reached for the database')
  }),
  registerHandler: vi.fn(),
}))

vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  getSupabaseAdmin,
}))

vi.mock('../jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../jobs')>()),
  registerHandler,
}))

import { handleDiagnosticNoop, registerJobHandlers } from '../job-handlers'
import type { JobRecord } from '../jobs'

function probe(payload: Record<string, unknown> = {}): JobRecord {
  return {
    id: 'probe-0001',
    customer_id: null,
    kind: 'diagnostic.noop',
    payload,
    idempotency_key: null,
    status: 'running',
    attempts: 1,
    max_attempts: 1,
    last_error: null,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  getSupabaseAdmin.mockClear()
})

describe('diagnostic.noop', () => {
  it('completes without touching the database or the network', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network reached'))

    await expect(handleDiagnosticNoop(probe())).resolves.toBeUndefined()

    expect(getSupabaseAdmin).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('ignores its payload, so nothing planted in it can steer the handler', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network reached'))

    // Shaped like the payloads of kinds that do have effects.
    await expect(
      handleDiagnosticNoop(
        probe({
          workflowId: 'wf_1',
          dealId: 'deal_1',
          url: 'https://example.com/hook',
          p_retain_days: 0,
        })
      )
    ).resolves.toBeUndefined()

    expect(getSupabaseAdmin).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('logs the job id and never the payload', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await handleDiagnosticNoop(probe({ note: 'SENTINEL-written-by-whoever-planted-it' }))

    const output = log.mock.calls.flat().join(' ')
    expect(output).toContain('probe-0001')
    expect(output).not.toContain('SENTINEL')
  })

  it('is registered with the worker', () => {
    // An unregistered kind is dead-lettered on its first claim rather than
    // retried, and a single dead job is enough to trip the operator alert — so
    // a probe whose handler was never wired up would not just fail, it would
    // send the operator an alert email about the probe itself.
    registerJobHandlers()

    expect(registerHandler).toHaveBeenCalledWith('diagnostic.noop', handleDiagnosticNoop)
  })
})
