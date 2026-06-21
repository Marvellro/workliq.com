import { createClient } from '@supabase/supabase-js'

// HubSpot access tokens expire after ~30 minutes. We refresh proactively when
// within REFRESH_BUFFER_MS of expiry to avoid a mid-request token failure.
const REFRESH_BUFFER_MS = 5 * 60 * 1000 // 5 minutes

const HUBSPOT_CLIENT_ID = '399fbd57-9bd1-4d3a-926a-31f18232704f'
const HUBSPOT_REDIRECT_URI = 'https://workliq.com/api/auth/hubspot/callback'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Returns a valid HubSpot access token for the given customer, refreshing via
// the stored refresh_token if the access token is expired or about to expire.
// Throws if there is no connection or if the refresh call fails.
export async function getValidHubSpotToken(customerId: string): Promise<string> {
  const supabase = getSupabaseAdmin()

  const { data: conn, error } = await supabase
    .from('hubspot_connections')
    .select('access_token, refresh_token, expires_at')
    .eq('customer_id', customerId)
    .single()

  if (error || !conn) {
    throw new Error(`No HubSpot connection found for customer ${customerId}`)
  }

  const expiresAt = new Date(conn.expires_at).getTime()

  if (Date.now() + REFRESH_BUFFER_MS < expiresAt) {
    // Token is still valid with comfortable headroom — use it as-is
    return conn.access_token
  }

  // Token expired or expiring soon — refresh it
  const refreshRes = await fetch('https://api.hubapi.com/oauth/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: HUBSPOT_CLIENT_ID,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET!,
      redirect_uri: HUBSPOT_REDIRECT_URI,
      refresh_token: conn.refresh_token,
    }),
  })

  if (!refreshRes.ok) {
    const body = await refreshRes.text()
    throw new Error(
      `HubSpot token refresh failed (${refreshRes.status}): ${body}`
    )
  }

  const refreshed = await refreshRes.json() as {
    access_token: string
    refresh_token: string
    expires_in: number
  }

  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()

  const { error: updateError } = await supabase
    .from('hubspot_connections')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('customer_id', customerId)

  if (updateError) {
    // Log but don't throw — the refreshed token is still usable for this request.
    // The next call will refresh again (slightly wasteful but safe).
    console.error('Failed to persist refreshed HubSpot tokens:', updateError)
  }

  return refreshed.access_token
}
