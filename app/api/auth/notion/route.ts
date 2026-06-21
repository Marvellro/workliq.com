import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getCustomerSession } from '@/lib/session'

const NOTION_CLIENT_ID = '386d872b-594c-8162-84f2-00370d6f32cc'
const NOTION_REDIRECT_URI = 'https://workliq.com/api/auth/notion/callback'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://workliq.com'

export async function GET() {
  const session = await getCustomerSession()
  if (!session) {
    return NextResponse.redirect(`${APP_URL}/dashboard/login`)
  }

  // CSRF state token — same pattern as HubSpot and Slack.
  const state = randomBytes(32).toString('hex')

  // owner=user tells Notion this is a user-level install (not a bot-level one),
  // which is required for public OAuth integrations.
  const authorizeUrl = new URL('https://api.notion.com/v1/oauth/authorize')
  authorizeUrl.searchParams.set('client_id', NOTION_CLIENT_ID)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('owner', 'user')
  authorizeUrl.searchParams.set('redirect_uri', NOTION_REDIRECT_URI)
  authorizeUrl.searchParams.set('state', state)

  const response = NextResponse.redirect(authorizeUrl.toString())
  response.cookies.set('notion_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10,
  })

  return response
}
