import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getCustomerSession } from '@/lib/session'
import { appUrl, OAUTH_REDIRECT_URIS } from '@/lib/config'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

import { HUBSPOT_CLIENT_ID } from '@/lib/hubspot'

const HUBSPOT_REDIRECT_URI = OAUTH_REDIRECT_URIS.hubspot
const HUBSPOT_SCOPE = 'oauth crm.objects.deals.read'

export async function GET() {
  const session = await getCustomerSession()
  if (!session) {
    return NextResponse.redirect(appUrl('/dashboard/login'))
  }

  const limit = await checkRateLimit(
    `oauth:hubspot:${session.customerId}`,
    RATE_LIMITS.oauthStart
  )
  if (!limit.allowed) return rateLimitResponse(limit)

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
