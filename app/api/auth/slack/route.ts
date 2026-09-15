import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getCustomerSession } from '@/lib/session'
import { appUrl, OAUTH_REDIRECT_URIS, OAUTH_CLIENT_IDS } from '@/lib/config'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

const SLACK_CLIENT_ID = OAUTH_CLIENT_IDS.slack
const SLACK_REDIRECT_URI = OAUTH_REDIRECT_URIS.slack

export async function GET() {
  const session = await getCustomerSession()
  if (!session) {
    return NextResponse.redirect(appUrl('/dashboard/login'))
  }

  const limit = await checkRateLimit(
    `oauth:slack:${session.customerId}`,
    RATE_LIMITS.oauthStart
  )
  if (!limit.allowed) return rateLimitResponse(limit)

  // CSRF state token — same pattern as HubSpot. Stored in an httpOnly cookie
  // and verified when Slack echoes it back in the callback.
  const state = randomBytes(32).toString('hex')

  const authorizeUrl = new URL('https://slack.com/oauth/v2/authorize')
  authorizeUrl.searchParams.set('client_id', SLACK_CLIENT_ID)
  authorizeUrl.searchParams.set('redirect_uri', SLACK_REDIRECT_URI)
  // incoming-webhook scope: Slack's consent screen lets the customer pick which
  // channel to post to — we don't build a channel picker ourselves.
  authorizeUrl.searchParams.set('scope', 'incoming-webhook')
  authorizeUrl.searchParams.set('state', state)

  const response = NextResponse.redirect(authorizeUrl.toString())
  response.cookies.set('slack_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10, // 10 minutes — plenty for the OAuth round-trip
  })

  return response
}
