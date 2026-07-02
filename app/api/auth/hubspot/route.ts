import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getCustomerSession } from '@/lib/session'

const HUBSPOT_CLIENT_ID = '399fbd57-9bd1-4d3a-926a-31f18232704f'
const HUBSPOT_REDIRECT_URI = https://www.workliq.com/api/auth/hubspot/callback'
const HUBSPOT_SCOPE = 'oauth crm.objects.deals.read'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://workliq.com'

export async function GET() {
  const session = await getCustomerSession()
  if (!session) {
    return NextResponse.redirect(`${APP_URL}/dashboard/login`)
  }

  // Generate a random state token for CSRF protection. It's stored in an
  // httpOnly cookie and must match the value HubSpot echoes back in the
  // callback — any mismatch aborts the flow.
  const state = randomBytes(32).toString('hex')

  const authorizeUrl = new URL('https://app.hubspot.com/oauth/authorize')
  authorizeUrl.searchParams.set('client_id', HUBSPOT_CLIENT_ID)
  authorizeUrl.searchParams.set('redirect_uri', HUBSPOT_REDIRECT_URI)
  authorizeUrl.searchParams.set('scope', HUBSPOT_SCOPE)
  authorizeUrl.searchParams.set('state', state)

  const response = NextResponse.redirect(authorizeUrl.toString())
  response.cookies.set('hubspot_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10, // 10 minutes — plenty for the OAuth round-trip
  })

  return response
}
