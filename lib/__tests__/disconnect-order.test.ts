import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'crypto'

// The order Disconnect does things in, and what it touches.
//
//   pause the workflows that need it → delete our copy → delete what it left
//   behind → ask the provider to revoke
//
// Each failure must stop the steps after it, and say which part already
// happened. And every write must be scoped to the customer doing it: this runs
// with the service-role key, which would otherwise delete anyone's rows.

const { getSupabaseAdmin } = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }))

vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  getSupabaseAdmin,
}))

import { disconnectConnection } from '../disconnect'
import { encrypt, __setKeysForTesting } from '../crypto'

const CUSTOMER = 'cust-1111'

type Op = [string, unknown[]]
type Call = { table: string; ops: Op[] }
type Answer = { data?: unknown; error?: { message: string } | null; count?: number }

/**
 * A stand-in for the Supabase client that records every chained call and
 * answers each query from `respond`. A query is "run" when it is awaited.
 */
function fakeDatabase(respond: (call: Call) => Answer) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      const call: Call = { table, ops: [] }
      calls.push(call)
      const query: Record<string, unknown> = new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === 'then') {
              return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
                Promise.resolve()
                  .then(() => respond(call))
                  .then((a) => ({ data: a.data ?? null, error: a.error ?? null, count: a.count ?? null }))
                  .then(resolve, reject)
            }
            return (...args: unknown[]) => {
              call.ops.push([prop, args])
              return query
            }
          },
        }
      )
      return query
    },
  }
  return { client, calls }
}

const kind = (call: Call) =>
  call.ops.find(([op]) => ['select', 'update', 'delete', 'insert', 'upsert'].includes(op))?.[0] ?? 'select'
const has = (call: Call, op: string, ...args: unknown[]) =>
  call.ops.some(([o, a]) => o === op && JSON.stringify(a) === JSON.stringify(args))

const workflows = [
  { id: 'wf-slack', name: 'Post to Slack', enabled: true, steps: [{ action_type: 'slack_message', action_config: {} }] },
  { id: 'wf-legacy', name: 'Old AI to Slack', enabled: true, steps: [{ action_type: 'ai_step', action_config: { ai_task: 'summarize', deliver_to: 'slack_message' } }] },
  { id: 'wf-off', name: 'Slack, already off', enabled: false, steps: [{ action_type: 'slack_message', action_config: {} }] },
  { id: 'wf-hook', name: 'Webhook only', enabled: true, steps: [{ action_type: 'webhook', action_config: { url: 'https://example.com' } }] },
]

let fetchCalls: string[]

beforeEach(() => {
  __setKeysForTesting(new Map([[1, randomBytes(32)]]))
  fetchCalls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input)
      fetchCalls.push(url)
      if (url.endsWith('auth.revoke')) return new Response(JSON.stringify({ ok: true, revoked: true }), { status: 200 })
      if (url.startsWith('https://hooks.slack.com/')) return new Response('no_service', { status: 404 })
      if (url.endsWith('/oauth/2026-03/token')) return new Response(JSON.stringify({ access_token: 'acc', expires_in: 1800 }), { status: 200 })
      if (url.includes('external-install')) return new Response(null, { status: 204 })
      if (url.endsWith('/token/revoke')) return new Response(null, { status: 200 })
      throw new Error(`unexpected ${url}`)
    })
  )
})

afterEach(() => {
  __setKeysForTesting(null)
  vi.unstubAllGlobals()
  getSupabaseAdmin.mockReset()
})

function slackRow() {
  return {
    access_token: encrypt('xoxb-token-1234567890'),
    webhook_url: encrypt('https://hooks.slack.com/services/T1/B1/secretsecret'),
  }
}

/** A healthy database for a Slack disconnect, with optional failures. */
function slackDatabase(fail: { pause?: boolean; delete?: boolean; jobs?: boolean } = {}) {
  return fakeDatabase((call) => {
    const k = kind(call)
    if (call.table === 'slack_connections' && k === 'select') return { data: slackRow() }
    if (call.table === 'workflows' && k === 'select') return { data: workflows }
    if (call.table === 'workflows' && k === 'update') {
      if (fail.pause) return { error: { message: 'pause failed' } }
      const ids = call.ops.find(([o, a]) => o === 'in' && a[0] === 'id')![1][1] as string[]
      return { data: workflows.filter((w) => ids.includes(w.id)).map(({ id, name }) => ({ id, name })) }
    }
    if (call.table === 'slack_connections' && k === 'delete') {
      return fail.delete ? { error: { message: 'delete failed' } } : {}
    }
    if (call.table === 'jobs' && k === 'delete') return fail.jobs ? { error: { message: 'jobs failed' } } : {}
    throw new Error(`unexpected ${k} on ${call.table}`)
  })
}

describe('a Slack disconnect', () => {
  it('pauses, deletes, cleans up, then revokes — in that order', async () => {
    const db = slackDatabase()
    getSupabaseAdmin.mockReturnValue(db.client)

    const result = await disconnectConnection(CUSTOMER, 'slack')

    expect(result.status).toBe('disconnected')
    const writes = db.calls.filter((c) => kind(c) !== 'select').map((c) => `${kind(c)} ${c.table}`)
    expect(writes).toEqual(['update workflows', 'delete slack_connections', 'delete jobs'])
    // Revocation happened, and only after the row was gone (the writes above
    // all completed before fetch was first called — the fake runs in order).
    expect(fetchCalls[0]).toBe('https://slack.com/api/auth.revoke')
    if (result.status === 'disconnected') expect(result.revocation.outcome).toBe('revoked')
  })

  it('pauses exactly the running workflows that send to Slack, legacy ones included', async () => {
    const db = slackDatabase()
    getSupabaseAdmin.mockReturnValue(db.client)

    const result = await disconnectConnection(CUSTOMER, 'slack')

    const pause = db.calls.find((c) => c.table === 'workflows' && kind(c) === 'update')!
    expect(has(pause, 'in', 'id', ['wf-slack', 'wf-legacy'])).toBe(true)
    // Switched off as the customer's own act, not marked as a billing pause.
    const fields = pause.ops.find(([o]) => o === 'update')![1][0] as Record<string, unknown>
    expect(fields.enabled).toBe(false)
    expect(fields).not.toHaveProperty('paused_by_plan')

    if (result.status === 'disconnected') {
      expect(result.pausedWorkflows.map((w) => w.id)).toEqual(['wf-slack', 'wf-legacy'])
    }
  })

  it('cancels queued work for every workflow that uses Slack, switched on or not', async () => {
    const db = slackDatabase()
    getSupabaseAdmin.mockReturnValue(db.client)

    await disconnectConnection(CUSTOMER, 'slack')

    const jobs = db.calls.find((c) => c.table === 'jobs')!
    expect(has(jobs, 'eq', 'status', 'pending')).toBe(true)
    expect(has(jobs, 'eq', 'kind', 'workflow.action')).toBe(true)
    expect(has(jobs, 'in', 'payload->>workflowId', ['wf-slack', 'wf-legacy', 'wf-off'])).toBe(true)
  })

  it('scopes every query to the customer', async () => {
    const db = slackDatabase()
    getSupabaseAdmin.mockReturnValue(db.client)

    await disconnectConnection(CUSTOMER, 'slack')

    for (const call of db.calls) {
      expect(has(call, 'eq', 'customer_id', CUSTOMER), `${kind(call)} ${call.table}`).toBe(true)
    }
  })

  it('stops before deleting anything when the workflows cannot be paused', async () => {
    const db = slackDatabase({ pause: true })
    getSupabaseAdmin.mockReturnValue(db.client)

    const result = await disconnectConnection(CUSTOMER, 'slack')

    expect(result).toEqual({ status: 'failed', stage: 'pause', pausedWorkflows: [] })
    expect(db.calls.some((c) => kind(c) === 'delete')).toBe(false)
    expect(fetchCalls).toEqual([])
  })

  it('does not revoke when our copy could not be deleted, and says what was paused', async () => {
    const db = slackDatabase({ delete: true })
    getSupabaseAdmin.mockReturnValue(db.client)

    const result = await disconnectConnection(CUSTOMER, 'slack')

    expect(result.status).toBe('failed')
    if (result.status === 'failed') {
      expect(result.stage).toBe('delete')
      expect(result.pausedWorkflows.map((w) => w.id)).toEqual(['wf-slack', 'wf-legacy'])
    }
    expect(fetchCalls).toEqual([])
  })

  it('still revokes, and reports it, when cleanup is incomplete', async () => {
    const db = slackDatabase({ jobs: true })
    getSupabaseAdmin.mockReturnValue(db.client)

    const result = await disconnectConnection(CUSTOMER, 'slack')

    expect(result.status).toBe('disconnected')
    if (result.status === 'disconnected') expect(result.cleanupComplete).toBe(false)
    expect(fetchCalls.length).toBeGreaterThan(0)
  })

  it('still deletes a credential that will not decrypt, and does not claim to have revoked it', async () => {
    const db = fakeDatabase((call) => {
      const k = kind(call)
      if (call.table === 'slack_connections' && k === 'select') return { data: { access_token: 'v1:garbage', webhook_url: 'v1:garbage' } }
      if (call.table === 'workflows' && k === 'select') return { data: [] }
      return {}
    })
    getSupabaseAdmin.mockReturnValue(db.client)

    const result = await disconnectConnection(CUSTOMER, 'slack')

    expect(db.calls.some((c) => c.table === 'slack_connections' && kind(c) === 'delete')).toBe(true)
    expect(result.status).toBe('disconnected')
    if (result.status === 'disconnected') expect(result.revocation.outcome).toBe('unconfirmed')
    expect(fetchCalls).toEqual([])
  })
})

describe('a HubSpot disconnect', () => {
  function hubspotDatabase(otherAccountsOnPortal = 0) {
    return fakeDatabase((call) => {
      const k = kind(call)
      if (call.table === 'hubspot_connections' && k === 'select' && has(call, 'eq', 'hub_id', '148743548')) {
        return { count: otherAccountsOnPortal }
      }
      if (call.table === 'hubspot_connections' && k === 'select') {
        return { data: { refresh_token: encrypt('refresh-token-abcdefgh'), hub_id: '148743548' } }
      }
      if (call.table === 'workflows' && k === 'select') return { data: workflows }
      if (call.table === 'workflows' && k === 'update') return { data: [] }
      return {}
    })
  }

  it('pauses every running workflow, because every one starts from HubSpot', async () => {
    const db = hubspotDatabase()
    getSupabaseAdmin.mockReturnValue(db.client)

    await disconnectConnection(CUSTOMER, 'hubspot')

    const pause = db.calls.find((c) => c.table === 'workflows' && kind(c) === 'update')!
    expect(has(pause, 'in', 'id', ['wf-slack', 'wf-legacy', 'wf-hook'])).toBe(true)
  })

  it('deletes the events and deal stages it cached, and everything queued', async () => {
    const db = hubspotDatabase()
    getSupabaseAdmin.mockReturnValue(db.client)

    await disconnectConnection(CUSTOMER, 'hubspot')

    const deleted = db.calls.filter((c) => kind(c) === 'delete').map((c) => c.table)
    expect(deleted).toEqual(['hubspot_connections', 'jobs', 'hubspot_events', 'deal_snapshots'])
    const jobs = db.calls.find((c) => c.table === 'jobs')!
    expect(has(jobs, 'in', 'kind', ['hubspot.event', 'workflow.action'])).toBe(true)
    expect(has(jobs, 'eq', 'status', 'pending')).toBe(true)
  })

  it('scopes every read and write to the customer, except the shared-portal count', async () => {
    // Run with the service-role key: an unscoped delete here would remove
    // every account's HubSpot events, not this one's.
    const db = hubspotDatabase()
    getSupabaseAdmin.mockReturnValue(db.client)

    await disconnectConnection(CUSTOMER, 'hubspot')

    const portalCount = db.calls.filter((c) => has(c, 'eq', 'hub_id', '148743548'))
    expect(portalCount).toHaveLength(1)
    // It only counts, and reads nothing back.
    expect(has(portalCount[0], 'select', 'id', { count: 'exact', head: true })).toBe(true)

    for (const call of db.calls.filter((c) => !portalCount.includes(c))) {
      expect(has(call, 'eq', 'customer_id', CUSTOMER), `${kind(call)} ${call.table}`).toBe(true)
    }
  })

  it('uninstalls the app when no other account uses the portal', async () => {
    getSupabaseAdmin.mockReturnValue(hubspotDatabase(0).client)
    const result = await disconnectConnection(CUSTOMER, 'hubspot')
    expect(fetchCalls.some((u) => u.includes('external-install'))).toBe(true)
    if (result.status === 'disconnected') expect(result.revocation.outcome).toBe('revoked')
  })

  it('leaves the app installed when another account still uses the portal', async () => {
    getSupabaseAdmin.mockReturnValue(hubspotDatabase(1).client)
    const result = await disconnectConnection(CUSTOMER, 'hubspot')
    expect(fetchCalls.some((u) => u.includes('external-install'))).toBe(false)
    if (result.status === 'disconnected') expect(result.revocation.outcome).toBe('unconfirmed')
  })
})

describe('nothing connected', () => {
  it('changes nothing and calls no one', async () => {
    const db = fakeDatabase((call) => (kind(call) === 'select' ? { data: null } : { error: { message: 'should not write' } }))
    getSupabaseAdmin.mockReturnValue(db.client)

    expect(await disconnectConnection(CUSTOMER, 'notion')).toEqual({ status: 'not_connected' })
    expect(db.calls).toHaveLength(1)
    expect(fetchCalls).toEqual([])
  })
})
