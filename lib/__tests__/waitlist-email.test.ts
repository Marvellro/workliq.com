import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The two routes where a person is told something about an email. When Resend
// refuses — and its SDK never throws, it resolves with { data: null, error } —
// the waitlist used to answer success while the person waited for a
// confirmation that was never sent. Now it says so. The confirmation route
// has already confirmed the spot by the time it sends, so a refused welcome
// email must not undo that or strand the person on an error page.

const { send, upsert } = vi.hoisted(() => ({ send: vi.fn(), upsert: vi.fn() }))

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
      q.single = async () => ({ data: { email: 'person@example.com', name: 'Ada', confirmed: false }, error: null })
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

function join() {
  return joinWaitlist(
    new Request('https://www.workliq.com/api/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
      body: JSON.stringify({ name: 'Ada', email: 'person@example.com', role: 'Founder' }),
    })
  )
}

beforeEach(() => {
  send.mockReset()
  upsert.mockReset().mockResolvedValue({ error: null })
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

describe('confirming a spot', () => {
  it('still lands on the confirmed page when the welcome email is refused, and logs it', async () => {
    send.mockResolvedValue(REFUSED)
    const res = await confirmSpot(new Request('https://www.workliq.com/api/confirm?token=t1'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/\/confirmed$/)
    expect(console.error).toHaveBeenCalledWith('Waitlist welcome email was not sent:', expect.anything())
  })
})
