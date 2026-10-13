import { describe, it, expect, vi, afterEach } from 'vitest'
import { sendHeartbeat } from '../heartbeat'

// The heartbeat is a dead-man's switch: its whole value is in what it does NOT
// send. A ping on an unhealthy run reports the system alive through an outage;
// a ping that carries data makes the privacy policy's "This list is complete"
// false; a logged URL hands anyone with log access the means to mask an outage.
// Each of those is a test below, written so that the failure is loud.

const URL_OK = 'https://hc-ping.example/3f1c-check'

function respond(status: number) {
  return vi.fn<typeof fetch>(async () => new Response(null, { status }))
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('sendHeartbeat — whether to ping at all', () => {
  it('says "unconfigured" and sends nothing when no URL is set', async () => {
    const fetchImpl = respond(200)
    expect(await sendHeartbeat({ healthy: true, url: '', fetchImpl })).toBe('unconfigured')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reports an unarmed switch as unconfigured even on an unhealthy run', async () => {
    // "withheld" here would read as the switch working as designed.
    const fetchImpl = respond(200)
    expect(await sendHeartbeat({ healthy: false, url: '', fetchImpl })).toBe('unconfigured')
  })

  it('refuses a non-https URL rather than sending it in clear', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchImpl = respond(200)
    expect(await sendHeartbeat({ healthy: true, url: 'http://hc-ping.example/x', fetchImpl })).toBe('misconfigured')
    expect(await sendHeartbeat({ healthy: true, url: 'not a url', fetchImpl })).toBe('misconfigured')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('withholds the ping when the run was unhealthy — the silence is the alarm', async () => {
    const fetchImpl = respond(200)
    expect(await sendHeartbeat({ healthy: false, url: URL_OK, fetchImpl })).toBe('withheld')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reads WORKER_HEARTBEAT_URL when no URL is passed', async () => {
    vi.stubEnv('WORKER_HEARTBEAT_URL', URL_OK)
    const fetchImpl = respond(200)
    expect(await sendHeartbeat({ healthy: true, fetchImpl })).toBe('sent')
    expect(fetchImpl.mock.calls[0][0]).toBe(URL_OK)
  })
})

describe('sendHeartbeat — what the ping is', () => {
  it('pings exactly once, as a bare GET carrying nothing', async () => {
    const fetchImpl = respond(200)
    expect(await sendHeartbeat({ healthy: true, url: URL_OK, fetchImpl })).toBe('sent')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [target, init] = fetchImpl.mock.calls[0]
    expect(target).toBe(URL_OK) // nothing appended
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
    expect(init?.headers).toBeUndefined()
  })
})

describe('sendHeartbeat — when the ping fails', () => {
  it('reports a provider error as failed, without throwing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await sendHeartbeat({ healthy: true, url: URL_OK, fetchImpl: respond(500) })).toBe('failed')
  })

  it('reports a network failure as failed, without throwing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError(`fetch failed for ${URL_OK}`)
    })
    expect(await sendHeartbeat({ healthy: true, url: URL_OK, fetchImpl })).toBe('failed')
  })

  it('gives up at the timeout rather than holding the worker open', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // A service that never answers, but honours the abort signal as fetch does.
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
        })
    )
    const started = Date.now()
    expect(await sendHeartbeat({ healthy: true, url: URL_OK, fetchImpl, timeoutMs: 30 })).toBe('failed')
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('never writes the URL to the logs, even when the error message contains it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError(`fetch failed for ${URL_OK}`)
    })

    await sendHeartbeat({ healthy: true, url: URL_OK, fetchImpl })
    await sendHeartbeat({ healthy: true, url: URL_OK, fetchImpl: respond(503) })
    await sendHeartbeat({ healthy: true, url: 'http://hc-ping.example/3f1c-check', fetchImpl })

    const logged = [...warn.mock.calls, ...error.mock.calls].flat().map(String).join(' ')
    expect(logged).not.toContain('3f1c-check')
  })
})
