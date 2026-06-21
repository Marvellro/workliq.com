import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getCustomerSession } from '@/lib/session'

const SLACK_CLIENT_ID = '1139561584631.11439398705216'
const SLACK_REDIRECT_URI = 'https://workliq.com/api/auth/slack/callback'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://workliq.com'

export async function GET() {
  const session = await getCustomerSession()
  if (!session) {
    return NextResponse.redirect(`${APP_URL}/dashboard/login`)
  }

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
