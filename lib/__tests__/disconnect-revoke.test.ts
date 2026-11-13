import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { revokeHubSpot, revokeSlack, revokeNotion, scrub } from '../disconnect'

// "Revoked" is shown to a customer as a promise that Workliq's access is gone.
// So it may only be reported when the provider proves it, and these tests pin
// what counts as proof for each one.
//
// The HubSpot case is the reason this file exists: HubSpot's revoke endpoint
// answers 200 with an empty body to a made-up client and a made-up token
// (measured 13 Nov 2026). Code that trusted that 200 would tell every customer
// their access was revoked, whether or not anything happened.

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

const REFRESH = 'hs-refresh-token-REAL-SECRET-1234'
const ACCESS = 'hs-access-token-FRESH-5678'
const SLACK_TOKEN = 'xoxb-slack-token-SECRET-9999'
const HOOK = 'https://hooks.slack.com/services/T0001/B0001/SECRETPATHabcdef'
const NOTION_TOKEN = 'ntn_notion-token-SECRET-4242'

let calls: { url: string; init: RequestInit }[]

function stubFetch(handler: Handler) {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input)
      calls.push({ url, init })
      return handler(url, init)
    })
  )
}

const text = (status: number, body = '') => new Response(body || null, { status })
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  process.env.HUBSPOT_CLIENT_SECRET = 'hubspot-client-secret-xyz'
  process.env.NOTION_CLIENT_SECRET = 'notion-client-secret-xyz'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** No credential may ever travel in a URL, where it lands in access logs. */
function expectNoSecretInAnyUrl() {
  for (const { url } of calls) {
    for (const secret of [REFRESH, ACCESS, SLACK_TOKEN, NOTION_TOKEN]) expect(url).not.toContain(secret)
  }
}

// ── HubSpot ──────────────────────────────────────────────────────────────────

describe('revokeHubSpot', () => {
  function hubspot(overrides: { refresh?: Response; uninstall?: Response; revoke?: Response } = {}) {
    stubFetch((url) => {
      if (url.endsWith('/oauth/2026-03/token')) return overrides.refresh ?? json(200, { access_token: ACCESS, refresh_token: REFRESH, expires_in: 1800 })
      if (url.endsWith('/appinstalls/v3/external-install')) return overrides.uninstall ?? text(204)
      if (url.endsWith('/oauth/2026-03/token/revoke')) return overrides.revoke ?? text(200)
      throw new Error(`unexpected ${url}`)
    })
  }

  it('is revoked when HubSpot confirms the uninstall with a 204', async () => {
    hubspot()
    const r = await revokeHubSpot(REFRESH, { uninstall: true, customerId: 'c1' })
    expect(r.outcome).toBe('revoked')

    const uninstall = calls.find((c) => c.url.includes('external-install'))!
    expect(uninstall.init.method).toBe('DELETE')
    // The uninstall uses the freshly refreshed token, not the stored one.
    expect((uninstall.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${ACCESS}`)
    expectNoSecretInAnyUrl()
  })

  it('also revokes the refresh token, with the token in the body', async () => {
    hubspot()
    await revokeHubSpot(REFRESH, { uninstall: true, customerId: 'c1' })
    const revoke = calls.find((c) => c.url.endsWith('/token/revoke'))!
    const body = new URLSearchParams(String(revoke.init.body))
    expect(body.get('token')).toBe(REFRESH)
    expect(body.get('token_type_hint')).toBe('refresh_token')
  })

  it('does NOT report revoked on the strength of the revoke endpoint’s 200', async () => {
    // The uninstall fails; the revoke "succeeds" as it does for anything.
    hubspot({ uninstall: json(401, { status: 'error', category: 'INVALID_AUTHENTICATION' }) })
    const r = await revokeHubSpot(REFRESH, { uninstall: true, customerId: 'c1' })
    expect(r.outcome).toBe('unconfirmed')
    // It was still asked, as the documented way to end a grant.
    expect(calls.some((c) => c.url.endsWith('/token/revoke'))).toBe(true)
  })

  it('is already revoked when HubSpot refuses the refresh token itself', async () => {
    // What HubSpot answers once the app has been uninstalled from its side.
    hubspot({ refresh: text(400, '{"status":"BAD_REFRESH_TOKEN","message":"missing or invalid refresh token"}') })
    const r = await revokeHubSpot(REFRESH, { uninstall: true, customerId: 'c1' })
    expect(r.outcome).toBe('already_revoked')
    expect(calls.some((c) => c.url.includes('external-install'))).toBe(false)
  })

  it('does not blame the grant for our own bad client secret', async () => {
    hubspot({ refresh: text(400, '{"status":"BAD_CLIENT_SECRET"}') })
    const r = await revokeHubSpot(REFRESH, { uninstall: true, customerId: 'c1' })
    expect(r.outcome).toBe('unconfirmed')
  })

  it('does not uninstall a portal another Workliq account still uses', async () => {
    hubspot()
    const r = await revokeHubSpot(REFRESH, { uninstall: false, customerId: 'c1' })
    expect(calls.some((c) => c.url.includes('external-install'))).toBe(false)
    expect(r.outcome).toBe('unconfirmed')
  })

  it('revokes a rotated refresh token as well as the stored one', async () => {
    hubspot({ refresh: json(200, { access_token: ACCESS, refresh_token: 'rotated-refresh-token-0000', expires_in: 1800 }) })
    await revokeHubSpot(REFRESH, { uninstall: true, customerId: 'c1' })
    const revoked = calls
      .filter((c) => c.url.endsWith('/token/revoke'))
      .map((c) => new URLSearchParams(String(c.init.body)).get('token'))
    expect(revoked).toEqual([REFRESH, 'rotated-refresh-token-0000'])
  })

  it('is unconfirmed, not thrown, when HubSpot cannot be reached', async () => {
    stubFetch(() => {
      throw new TypeError('fetch failed')
    })
    const r = await revokeHubSpot(REFRESH, { uninstall: true, customerId: 'c1' })
    expect(r.outcome).toBe('unconfirmed')
  })

  it('keeps every secret out of the detail it returns for the logs', async () => {
    // A provider echoing a credential back in an error body must not carry
    // it into our logs.
    hubspot({ uninstall: text(500, `server error for token ${ACCESS} and ${REFRESH}`) })
    const r = await revokeHubSpot(REFRESH, { uninstall: true, customerId: 'c1' })
    expect(r.detail).not.toContain(ACCESS)
    expect(r.detail).not.toContain(REFRESH)
    expect(r.detail).toContain('[redacted]')
  })
})

// ── Slack ────────────────────────────────────────────────────────────────────

describe('revokeSlack', () => {
  function slack(revoke: Response, hook: Response) {
    stubFetch((url) => {
      if (url === 'https://slack.com/api/auth.revoke') return revoke
      if (url === HOOK) return hook
      throw new Error(`unexpected ${url}`)
    })
  }

  it('is revoked when the token is revoked and the webhook is then gone', async () => {
    slack(json(200, { ok: true, revoked: true }), text(404, 'no_service'))
    const r = await revokeSlack(SLACK_TOKEN, HOOK, 'c1')
    expect(r.outcome).toBe('revoked')

    const revoke = calls.find((c) => c.url.endsWith('auth.revoke'))!
    expect((revoke.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SLACK_TOKEN}`)
    expectNoSecretInAnyUrl()
  })

  it('checks the webhook with a body that posts nothing', async () => {
    slack(json(200, { ok: true, revoked: true }), text(404, 'no_service'))
    await revokeSlack(SLACK_TOKEN, HOOK, 'c1')
    const probe = calls.find((c) => c.url === HOOK)!
    // No `text` and no `blocks`: a live webhook refuses it rather than posting.
    expect(JSON.parse(String(probe.init.body))).toEqual({})
  })

  it('is unconfirmed while the webhook still answers as live', async () => {
    // A live webhook given no text says so with a 400. Slack said the token
    // was revoked; the webhook says otherwise, and the webhook is what we post
    // with.
    slack(json(200, { ok: true, revoked: true }), text(400, 'no_text'))
    const r = await revokeSlack(SLACK_TOKEN, HOOK, 'c1')
    expect(r.outcome).toBe('unconfirmed')
  })

  it('is already revoked when Slack had already refused the token', async () => {
    slack(json(200, { ok: false, error: 'token_revoked' }), text(404, 'no_team'))
    const r = await revokeSlack(SLACK_TOKEN, HOOK, 'c1')
    expect(r.outcome).toBe('already_revoked')
  })

  it('is unconfirmed when auth.revoke fails for a reason that is not a dead token', async () => {
    slack(json(200, { ok: false, error: 'ratelimited' }), text(404, 'no_service'))
    const r = await revokeSlack(SLACK_TOKEN, HOOK, 'c1')
    expect(r.outcome).toBe('unconfirmed')
  })

  it('never puts the webhook URL in the detail', async () => {
    slack(json(200, { ok: true, revoked: true }), text(400, `no_text at ${HOOK}`))
    const r = await revokeSlack(SLACK_TOKEN, HOOK, 'c1')
    expect(r.detail).not.toContain(HOOK)
    expect(r.detail).not.toContain('SECRETPATH')
  })
})

// ── Notion ───────────────────────────────────────────────────────────────────

describe('revokeNotion', () => {
  function notion(revoke: Response, me: Response) {
    stubFetch((url) => {
      if (url === 'https://api.notion.com/v1/oauth/revoke') return revoke
      if (url === 'https://api.notion.com/v1/users/me') return me
      throw new Error(`unexpected ${url}`)
    })
  }

  it('is revoked when Notion accepts the revoke and then refuses the token', async () => {
    notion(json(200, { request_id: 'r' }), json(401, { code: 'unauthorized' }))
    const r = await revokeNotion(NOTION_TOKEN)
    expect(r.outcome).toBe('revoked')

    const revoke = calls.find((c) => c.url.endsWith('/oauth/revoke'))!
    const headers = revoke.init.headers as Record<string, string>
    expect(headers.Authorization.startsWith('Basic ')).toBe(true)
    expect(headers['Notion-Version']).toBe('2026-03-11')
    expect(JSON.parse(String(revoke.init.body))).toEqual({ token: NOTION_TOKEN })
    expectNoSecretInAnyUrl()
  })

  it('is unconfirmed while Notion still accepts the token, whatever the revoke said', async () => {
    notion(json(200, { request_id: 'r' }), json(200, { object: 'user' }))
    const r = await revokeNotion(NOTION_TOKEN)
    expect(r.outcome).toBe('unconfirmed')
  })

  it('is already revoked when the revoke is refused but the token is dead anyway', async () => {
    notion(json(400, { error: 'invalid_grant' }), json(401, { code: 'unauthorized' }))
    const r = await revokeNotion(NOTION_TOKEN)
    expect(r.outcome).toBe('already_revoked')
  })

  it('is unconfirmed when Notion cannot be reached', async () => {
    stubFetch(() => {
      throw new TypeError('fetch failed')
    })
    const r = await revokeNotion(NOTION_TOKEN)
    expect(r.outcome).toBe('unconfirmed')
  })
})

describe('scrub', () => {
  it('removes every secret, flattens and bounds the text', () => {
    const out = scrub(`a ${REFRESH}\n b ${REFRESH} ${'x'.repeat(500)}`, [REFRESH, null, undefined])
    expect(out).not.toContain(REFRESH)
    expect(out).not.toContain('\n')
    expect(out.length).toBeLessThanOrEqual(200)
  })

  it('ignores secrets too short to be one, rather than shredding the text', () => {
    expect(scrub('ok 200', ['', 'ok'])).toBe('ok 200')
  })
})
