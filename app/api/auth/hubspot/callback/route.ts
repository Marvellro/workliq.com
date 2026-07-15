import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCustomerSession } from '@/lib/session'

const HUBSPOT_CLIENT_ID = '399fbd57-9bd1-4d3a-926a-31f18232704f'
const HUBSPOT_REDIRECT_URI = 'https://www.workliq.com/api/auth/hubspot/callback'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://workliq.com'

type HubSpotTokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number   // seconds until access_token expires
  token_type: string
  hub_id: number        // portal ID — now included directly in the 2026-03 token response
  scopes: string[]
}

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Extracts a single named cookie value from the raw Cookie header string.
function parseCookieValue(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)
  )
  return match ? decodeURIComponent(match[1]) : null
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const errorParam = searchParams.get('error')

  // HubSpot sends ?error= when the user cancels or denies on the consent screen
  if (errorParam) {
    console.error(
      'HubSpot OAuth denied:',
      errorParam,
      searchParams.get('error_description')
    )
    return NextResponse.redirect(`${APP_URL}/dashboard?error=hubspot_denied`)
  }

  if (!code || !state) {
    console.error('HubSpot callback missing code or state')
    return NextResponse.redirect(`${APP_URL}/dashboard?error=hubspot_invalid`)
  }

  // Verify the state parameter against the cookie set before the redirect.
  // A mismatch indicates a CSRF attempt or a stale/replayed callback — reject.
  const cookieHeader = req.headers.get('cookie') ?? ''
  const storedState = parseCookieValue(cookieHeader, 'hubspot_oauth_state')

  if (!storedState || storedState !== state) {
    console.error('HubSpot OAuth state mismatch — possible CSRF')
    return NextResponse.redirect(`${APP_URL}/dashboard?error=hubspot_state_mismatch`)
  }

  // Confirm the customer is still logged in before storing anything
  const session = await getCustomerSession()
  if (!session) {
    return NextResponse.redirect(`${APP_URL}/dashboard/login`)
  }

  // ── Step 1: Exchange authorization code for tokens ─────────────────────────
  // Uses the 2026-03 date-based OAuth endpoint (replaces the deprecated
  // /oauth/v1/token endpoint). hub_id now comes back directly in this
  // response, so no separate lookup call is needed afterward.
  let tokenData: HubSpotTokenResponse
  try {
    const tokenRes = await fetch('https://api.hubapi.com/oauth/2026-03/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: HUBSPOT_CLIENT_ID,
        client_secret: process.env.HUBSPOT_CLIENT_SECRET!,
        redirect_uri: HUBSPOT_REDIRECT_URI,
        code,
      }),
    })

    if (!tokenRes.ok) {
      const errText = await tokenRes.text()
      console.error('HubSpot token exchange failed:', tokenRes.status, errText)
      return NextResponse.redirect(`${APP_URL}/dashboard?error=hubspot_token_failed`)
    }

    tokenData = await tokenRes.json()
  } catch (err) {
    console.error('HubSpot token exchange network error:', err)
    return NextResponse.redirect(`${APP_URL}/dashboard?error=hubspot_token_failed`)
  }

  const hubId = String(tokenData.hub_id)

  // expires_in is seconds from now; store as an absolute UTC timestamp so the
  // refresh helper can compare directly against Date.now()
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString()

  // ── Step 2: Persist the connection ────────────────────────────────────────
  // Upsert on customer_id so reconnecting (e.g. the customer revoked and
  // re-installs) replaces the old tokens rather than duplicating the row.
  const { error: dbError } = await getSupabaseAdmin()
    .from('hubspot_connections')
    .upsert(
      {
        customer_id: session.customerId,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: expiresAt,
        hub_id: hubId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'customer_id' }
    )

  if (dbError) {
    console.error('Failed to store HubSpot connection:', dbError)
    return NextResponse.redirect(`${APP_URL}/dashboard?error=hubspot_db_failed`)
  }

  // Clear the state cookie now that it's been consumed
  const response = NextResponse.redirect(`${APP_URL}/dashboard?connected=hubspot`)
  response.cookies.set('hubspot_oauth_state', '', { maxAge: 0, path: '/' })
  return response
}
