import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Resend's SDK never throws: a refused email comes back as a resolved
// { data: null, error }. Every send here treated that as delivered, so a
// refused customer digest still stamped its items as reported — the customer
// was never told, and never would be — and a refused operator alert recorded
// itself as sent and then suppressed itself for a day.
//
// The fake Resend below returns exactly what the real SDK returns, and the
// tests check the consequence that matters: whether anything is recorded as
// told when nobody was.

const { send, getSupabaseAdmin } = vi.hoisted(() => ({
  send: vi.fn(),
  getSupabaseAdmin: vi.fn(),
}))

vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))

vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  getSupabaseAdmin,
}))

import { sendEmail, EmailNotSentError } from '../email'
import { runOperatorAlert } from '../ops-alert'
import { runNotificationSweep } from '../notify'
import { Resend } from 'resend'

// What Resend 3.5 resolves with when it refuses, and when it accepts.
const REFUSED = { data: null, error: { message: 'The workliq.com domain is not verified', name: 'validation_error' } }
const ACCEPTED = { data: { id: 'em_123' }, error: null }

type Write = { table: string; op: 'insert' | 'update'; payload: unknown }

/** A database that answers reads per table and records every write. */
function database(reads: Record<string, { data?: unknown; count?: number }>, writes: Write[]) {
  return {
    from(table: string) {
      const result = { error: null, data: [], count: 0, ...(reads[table] ?? {}) }
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'in', 'not', 'like', 'gte', 'order', 'limit']) q[m] = () => q
      q.insert = (payload: unknown) => {
        writes.push({ table, op: 'insert', payload })
        return Promise.resolve({ error: null })
      }
      q.update = (payload: unknown) => {
        writes.push({ table, op: 'update', payload })
        return q
      }
      q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject)
      return q
    },
  }
}

let writes: Write[]

beforeEach(() => {
  writes = []
  send.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubEnv('RESEND_API_KEY', 're_test')
  vi.stubEnv('OPS_ALERT_EMAIL', 'ops@example.com')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('sendEmail', () => {
  const resend = () => new Resend('re_test')
  const mail = { from: 'a@workliq.com', to: 'b@example.com', subject: 's', text: 't' }

  it('throws when Resend refuses, carrying its reason', async () => {
    send.mockResolvedValue(REFUSED)
    const err = await sendEmail(resend(), mail).catch((e) => e)
    expect(err).toBeInstanceOf(EmailNotSentError)
    expect(err.message).toContain('domain is not verified')
    expect(err.code).toBe('validation_error')
  })

  it('throws when Resend reports no error but no id either', async () => {
    send.mockResolvedValue({ data: null, error: null })
    await expect(sendEmail(resend(), mail)).rejects.toBeInstanceOf(EmailNotSentError)
  })

  it('returns the id when Resend accepts, and sends exactly what it was given', async () => {
    send.mockResolvedValue(ACCEPTED)
    await expect(sendEmail(resend(), mail)).resolves.toBe('em_123')
    expect(send).toHaveBeenCalledWith(mail)
  })
})

describe('the operator alert', () => {
  // One overdue job is enough for a signal; everything else is quiet.
  beforeEach(() => {
    getSupabaseAdmin.mockReturnValue(database({ ops_alerts: { data: [] } }, writes))
  })

  it('records nothing when Resend refuses, so the next run tries again — and says so', async () => {
    send.mockResolvedValue(REFUSED)
    const result = await runOperatorAlert(1)
    expect(result).toMatchObject({ configured: true, found: 1, sent: 0, failed: 1 })
    expect(writes.filter((w) => w.table === 'ops_alerts')).toEqual([])
  })

  it('records the alert as told only once Resend has accepted it', async () => {
    send.mockResolvedValue(ACCEPTED)
    const result = await runOperatorAlert(1)
    expect(result).toMatchObject({ sent: 1, failed: 0 })
    expect(writes).toContainEqual(
      expect.objectContaining({ table: 'ops_alerts', op: 'insert' })
    )
  })
})

describe('the customer digest', () => {
  // One customer with one broken Slack connection, nothing else.
  beforeEach(() => {
    getSupabaseAdmin.mockReturnValue(
      database(
        {
          slack_connections: {
            data: [{ customer_id: 'cust_1', last_error: 'invalid_webhook', last_error_at: '2026-11-12T00:00:00Z' }],
          },
          customers: { data: [{ id: 'cust_1', email: 'owner@example.com' }] },
        },
        writes
      )
    )
  })

  it('leaves the broken connection unstamped when Resend refuses, so the customer is told next sweep', async () => {
    send.mockResolvedValue(REFUSED)
    const result = await runNotificationSweep()
    expect(result).toMatchObject({ customersNotified: 0, failures: 1 })
    expect(writes.filter((w) => w.op === 'update')).toEqual([])
  })

  it('stamps the connection as reported only once Resend has accepted the digest', async () => {
    send.mockResolvedValue(ACCEPTED)
    const result = await runNotificationSweep()
    expect(result).toMatchObject({ customersNotified: 1, failures: 0 })
    expect(writes).toContainEqual(
      expect.objectContaining({ table: 'slack_connections', op: 'update', payload: expect.objectContaining({ broken_notified_at: expect.any(String) }) })
    )
  })
})
