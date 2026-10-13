import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// An unreachable queue and an empty queue used to produce the same result:
// claimed: 0. The worker therefore answered 200 through a database outage, and
// anything trusting that answer — a heartbeat above all — would have reported
// the system alive while nothing could run. claimFailed is what tells the two
// apart, and these tests pin it, including the case where the counts look
// healthy because work was done before the queue went away.

type RpcResult = { data: unknown; error: { message: string } | null }

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  getSupabaseAdmin: () => ({ rpc }),
}))

import { runJobs, registerHandler, type JobRecord } from '../jobs'

function job(id: string): JobRecord {
  return {
    id,
    customer_id: null,
    kind: 'diagnostic.noop',
    payload: {},
    idempotency_key: null,
    status: 'running',
    attempts: 1,
    max_attempts: 1,
    last_error: null,
  }
}

/** Successive claim_jobs results; every other RPC succeeds. */
function claims(...results: RpcResult[]) {
  rpc.mockImplementation(async (name: string): Promise<RpcResult> => {
    if (name === 'claim_jobs') return results.shift() ?? { data: [], error: null }
    return { data: null, error: null }
  })
}

beforeEach(() => {
  rpc.mockReset()
  registerHandler('diagnostic.noop', async () => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runJobs — reachable versus empty', () => {
  it('reports an empty queue as healthy', async () => {
    claims({ data: [], error: null })
    const r = await runJobs({ budgetMs: 1_000 })
    expect(r).toMatchObject({ claimed: 0, claimFailed: false })
  })

  it('reports an unreachable queue as a failure, not as empty', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    claims({ data: null, error: { message: 'connection refused' } })
    const r = await runJobs({ budgetMs: 1_000 })
    expect(r).toMatchObject({ claimed: 0, claimFailed: true })
  })

  it('still reports failure when the queue goes away mid-run, though the counts look fine', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    claims(
      { data: [job('a'), job('b')], error: null },
      { data: null, error: { message: 'connection reset' } }
    )
    const r = await runJobs({ budgetMs: 1_000 })
    expect(r).toMatchObject({ claimed: 2, succeeded: 2, claimFailed: true })
  })
})
