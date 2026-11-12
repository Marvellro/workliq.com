import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The two routes where a person is told something about an email.
//
// Delivery: when Resend refuses — and its SDK never throws, it resolves with
// { data: null, error } — the waitlist used to answer success while the person
// waited for a confirmation that was never sent. Now it says so. The
// confirmation route has already confirmed the spot by the time it sends, so a
// refused welcome email must not undo that or strand the person on an error
// page.
//
// Escaping: both emails carry the submitter's name, which a stranger types and
// which these routes send to an address the stranger chooses. It has to reach
// the email as text, or the waitlist is a way to send Workliq-signed phishing.
//
// Signups: the email-only form at the bottom of the page was rejected for
// every submission (the route required a name), and a second signup from the
// same address failed outright (an "upsert" that was really an insert into a
// table unique on email). Both are pinned below.

type Entry = { id: string; name: string; token: string; confirmed: boolean }

const { send, db } = vi.hoisted(() => ({
  send: vi.fn(),
  db: {
    /** What a lookup by email finds, if anything. */
    existing: null as Entry | null,
    /** What the confirmation route finds by token. */
    stored: { email: 'person@example.com', name: 'Ada', confirmed: false },
    inserts: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
  },
}))

vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))

vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  checkRateLimit: vi.fn(async () => ({ allowed: true, count: 1, limit: 5, resetAt: new Date() })),
}))

vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  getSupabaseAdmin: () => ({
    from: () => {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.eq = () => q
      q.maybeSingle = async () => ({ data: db.existing, error: null })
      q.single = async () => ({ data: db.stored, error: null })
      q.insert = async (row: Record<string, unknown>) => {
        db.inserts.push(row)
        return { error: null }
      }
      q.update = (row: Record<string, unknown>) => {
        db.updates.push(row)
        return q
      }
      q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve)
      return q
    },
  }),
}))

import { POST as joinWaitlist } from '@/app/api/waitlist/route'
import { GET as confirmSpot } from '@/app/api/confirm/route'

const REFUSED = { data: null, error: { message: 'The workliq.com domain is not verified', name: 'validation_error' } }
const ACCEPTED = { data: { id: 'em_1' }, error: null }

function join(body: Record<string, unknown> = { name: 'Ada', email: 'person@example.com', role: 'Founder' }) {
  return joinWaitlist(
    new Request('https://www.workliq.com/api/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
      body: JSON.stringify(body),
    })
  )
}

function confirm() {
  return confirmSpot(new Request('https://www.workliq.com/api/confirm?token=t1'))
}

// What a phisher would type as their "name".
const INJECTION = 'Ada</h1><a href="https://evil.example/login">Your account is locked — sign in</a><h1>'

/** The HTML handed to Resend on the most recent send. */
function sentHtml(): string {
  return String(send.mock.calls.at(-1)?.[0]?.html ?? '')
}

beforeEach(() => {
  send.mockReset()
  db.existing = null
  db.stored = { email: 'person@example.com', name: 'Ada', confirmed: false }
  db.inserts = []
  db.updates = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('joining the waitlist', () => {
  it('tells the person when the confirmation email was refused, instead of reporting success', async () => {
    send.mockResolvedValue(REFUSED)
    const res = await join()
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/couldn't send the confirmation email/)
  })

  it('reports success once the email was accepted', async () => {
    send.mockResolvedValue(ACCEPTED)
    const res = await join()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
  })
})

describe('the email-only form', () => {
  it('is accepted — it used to be rejected for every submission', async () => {
    send.mockResolvedValue(ACCEPTED)
    const res = await join({ email: 'person@example.com' })
    expect(res.status).toBe(200)
    expect(db.inserts).toEqual([expect.objectContaining({ email: 'person@example.com', name: '' })])
  })

  it('gets a greeting that reads naturally without a name', async () => {
    send.mockResolvedValue(ACCEPTED)
    await join({ email: 'person@example.com' })
    expect(sentHtml()).toContain('Hi there, confirm your spot')
    expect(sentHtml()).not.toContain('Hi , ')
  })
})

describe('the address', () => {
  it('is refused before anything is stored or sent when it is not an email', async () => {
    const res = await join({ email: 'not an address' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/valid email/)
    expect(db.inserts).toEqual([])
    expect(send).not.toHaveBeenCalled()
  })

  it('is stored trimmed and lowercased, so one person is one entry', async () => {
    send.mockResolvedValue(ACCEPTED)
    await join({ email: '  Ada@Example.COM ' })
    expect(db.inserts[0]).toMatchObject({ email: 'ada@example.com' })
  })
})

describe('signing up again', () => {
  it('re-sends the confirmation for an unconfirmed entry, with the same link, instead of failing', async () => {
    send.mockResolvedValue(ACCEPTED)
    db.existing = { id: 'w1', name: 'Ada', token: 'tok-existing', confirmed: false }
    const res = await join({ email: 'person@example.com' })
    expect(res.status).toBe(200)
    expect(db.inserts).toEqual([])
    expect(sentHtml()).toContain('token=tok-existing')
  })

  it('keeps a name given before, rather than blanking it from the email-only form', async () => {
    send.mockResolvedValue(ACCEPTED)
    db.existing = { id: 'w1', name: 'Ada', token: 'tok-existing', confirmed: false }
    await join({ email: 'person@example.com' })
    expect(db.updates).toEqual([])
  })

  it('takes a name given the second time when there was none', async () => {
    send.mockResolvedValue(ACCEPTED)
    db.existing = { id: 'w1', name: '', token: 'tok-existing', confirmed: false }
    await join({ name: 'Ada', email: 'person@example.com' })
    expect(db.updates).toEqual([expect.objectContaining({ name: 'Ada' })])
  })

  it('answers an already-confirmed address exactly like a new one, and sends nothing', async () => {
    db.existing = { id: 'w1', name: 'Ada', token: 'tok-existing', confirmed: true }
    const res = await join({ email: 'person@example.com' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(send).not.toHaveBeenCalled()
    expect(db.inserts).toEqual([])
    expect(db.updates).toEqual([])
  })
})

describe('a name containing markup', () => {
  it('reaches the confirmation email as text, never as markup', async () => {
    send.mockResolvedValue(ACCEPTED)
    await join({ name: INJECTION, email: 'person@example.com' })
    expect(sentHtml()).not.toContain('<a href="https://evil.example')
    expect(sentHtml()).toContain('&lt;a href=&quot;https://evil.example/login&quot;&gt;')
  })

  it('reaches the welcome email as text too, when it comes back out of the database', async () => {
    send.mockResolvedValue(ACCEPTED)
    db.stored = { ...db.stored, name: INJECTION }
    await confirm()
    expect(sentHtml()).not.toContain('<a href="https://evil.example')
    expect(sentHtml()).toContain('&lt;a href=&quot;https://evil.example/login&quot;&gt;')
  })
})

describe('confirming a spot', () => {
  it('still lands on the confirmed page when the welcome email is refused, and logs it', async () => {
    send.mockResolvedValue(REFUSED)
    const res = await confirm()
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/\/confirmed$/)
    expect(console.error).toHaveBeenCalledWith('Waitlist welcome email was not sent:', expect.anything())
  })

  it('welcomes an email-only signup without an empty name in the greeting', async () => {
    send.mockResolvedValue(ACCEPTED)
    db.stored = { ...db.stored, name: '' }
    await confirm()
    expect(sentHtml()).toContain("You're in. 🎉")
    expect(sentHtml()).not.toContain("You're in, .")
  })
})
