import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The two routes where a person is told something about an email. When Resend
// refuses — and its SDK never throws, it resolves with { data: null, error } —
// the waitlist used to answer success while the person waited for a
// confirmation that was never sent. Now it says so. The confirmation route
// has already confirmed the spot by the time it sends, so a refused welcome
// email must not undo that or strand the person on an error page.
//
// Both emails also carry the submitter's name, which a stranger types and
// which these routes send to an address the stranger chooses. It has to reach
// the email as text, or the waitlist is a way to send Workliq-signed phishing.

const { send, upsert, stored } = vi.hoisted(() => ({
  send: vi.fn(),
  upsert: vi.fn(),
  stored: { name: 'Ada' },
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
      q.upsert = upsert
      q.select = () => q
      q.eq = () => q
      q.single = async () => ({ data: { email: 'person@example.com', name: stored.name, confirmed: false }, error: null })
      q.update = () => q
      q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve)
      return q
    },
  }),
}))

import { POST as joinWaitlist } from '@/app/api/waitlist/route'
import { GET as confirmSpot } from '@/app/api/confirm/route'

const REFUSED = { data: null, error: { message: 'The workliq.com domain is not verified', name: 'validation_error' } }
const ACCEPTED = { data: { id: 'em_1' }, error: null }

function join(name = 'Ada') {
  return joinWaitlist(
    new Request('https://www.workliq.com/api/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
      body: JSON.stringify({ name, email: 'person@example.com', role: 'Founder' }),
    })
  )
}

// What a phisher would type as their "name": the waitlist sends to whatever
// address is supplied, so unescaped, this became a signed Workliq email
// carrying the attacker's link to anyone they chose.
const INJECTION = 'Ada</h1><a href="https://evil.example/login">Your account is locked — sign in</a><h1>'

/** The HTML handed to Resend on the most recent send. */
function sentHtml(): string {
  return String(send.mock.calls.at(-1)?.[0]?.html ?? '')
}

beforeEach(() => {
  send.mockReset()
  upsert.mockReset().mockResolvedValue({ error: null })
  stored.name = 'Ada'
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

describe('a name containing markup', () => {
  it('reaches the confirmation email as text, never as markup', async () => {
    send.mockResolvedValue(ACCEPTED)
    await join(INJECTION)
    expect(sentHtml()).not.toContain('<a href="https://evil.example')
    expect(sentHtml()).toContain('&lt;a href=&quot;https://evil.example/login&quot;&gt;')
  })

  it('reaches the welcome email as text too, when it comes back out of the database', async () => {
    send.mockResolvedValue(ACCEPTED)
    stored.name = INJECTION
    await confirmSpot(new Request('https://www.workliq.com/api/confirm?token=t1'))
    expect(sentHtml()).not.toContain('<a href="https://evil.example')
    expect(sentHtml()).toContain('&lt;a href=&quot;https://evil.example/login&quot;&gt;')
  })
})

describe('confirming a spot', () => {
  it('still lands on the confirmed page when the welcome email is refused, and logs it', async () => {
    send.mockResolvedValue(REFUSED)
    const res = await confirmSpot(new Request('https://www.workliq.com/api/confirm?token=t1'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/\/confirmed$/)
    expect(console.error).toHaveBeenCalledWith('Waitlist welcome email was not sent:', expect.anything())
  })
})
