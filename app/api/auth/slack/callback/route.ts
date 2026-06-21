import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCustomerSession } from '@/lib/session'

const SLACK_CLIENT_ID = '1139561584631.11439398705216'
const SLACK_REDIRECT_URI = 'https://workliq.com/api/auth/slack/callback'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://workliq.com'

type SlackOAuthResponse = {
  ok: boolean
  error?: string
  access_token: string
  incoming_webhook: {
    url: string
    channel: string       // e.g. "#deal-alerts"
    channel_id: string
    configuration_url: string
  }
  team: {
    id: string
    name: string
  }
}

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

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

  // Slack sends ?error=access_denied when the user cancels on the consent screen
  if (errorParam) {
    console.error('Slack OAuth denied:', errorParam)
    return NextResponse.redirect(`${APP_URL}/dashboard?error=slack_denied`)
  }

  if (!code || !state) {
    console.error('Slack callback missing code or state')
    return NextResponse.redirect(`${APP_URL}/dashboard?error=slack_invalid`)
  }

  // Verify the state parameter against the pre-redirect cookie
  const cookieHeader = req.headers.get('cookie') ?? ''
  const storedState = parseCookieValue(cookieHeader, 'slack_oauth_state')

  if (!storedState || storedState !== state) {
    console.error('Slack OAuth state mismatch — possible CSRF')
    return NextResponse.redirect(`${APP_URL}/dashboard?error=slack_state_mismatch`)
  }

  const session = await getCustomerSession()
  if (!session) {
    return NextResponse.redirect(`${APP_URL}/dashboard/login`)
  }

  // ── Exchange authorization code for token ─────────────────────────────────
  // Slack requires client credentials as HTTP Basic Auth (client_id:client_secret)
  // when calling oauth.v2.access.
  let tokenData: SlackOAuthResponse
  try {
    const credentials = Buffer.from(
      `${SLACK_CLIENT_ID}:${process.env.SLACK_CLIENT_SECRET}`
    ).toString('base64')

    const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        code,
        redirect_uri: SLACK_REDIRECT_URI,
      }),
    })

    if (!tokenRes.ok) {
      const errText = await tokenRes.text()
      console.error('Slack token exchange HTTP error:', tokenRes.status, errText)
      return NextResponse.redirect(`${APP_URL}/dashboard?error=slack_token_failed`)
    }

    tokenData = await tokenRes.json()

    // Slack always returns HTTP 200 and signals errors via the `ok` field
    if (!tokenData.ok) {
      console.error('Slack token exchange error:', tokenData.error)
      return NextResponse.redirect(`${APP_URL}/dashboard?error=slack_token_failed`)
    }
  } catch (err) {
    console.error('Slack token exchange network error:', err)
    return NextResponse.redirect(`${APP_URL}/dashboard?error=slack_token_failed`)
  }

  // Validate that the response contains the webhook fields we depend on
  if (!tokenData.incoming_webhook?.url || !tokenData.incoming_webhook?.channel) {
    console.error('Slack response missing incoming_webhook fields:', tokenData)
    return NextResponse.redirect(`${APP_URL}/dashboard?error=slack_token_failed`)
  }

  // ── Persist the connection ─────────────────────────────────────────────────
  const { error: dbError } = await getSupabaseAdmin()
    .from('slack_connections')
    .upsert(
      {
        customer_id: session.customerId,
        access_token: tokenData.access_token,
        webhook_url: tokenData.incoming_webhook.url,
        channel_name: tokenData.incoming_webhook.channel,
        team_id: tokenData.team.id,
        team_name: tokenData.team.name,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'customer_id' }
    )

  if (dbError) {
    console.error('Failed to store Slack connection:', dbError)
    return NextResponse.redirect(`${APP_URL}/dashboard?error=slack_db_failed`)
  }

  const response = NextResponse.redirect(`${APP_URL}/dashboard?connected=slack`)
  response.cookies.set('slack_oauth_state', '', { maxAge: 0, path: '/' })
  return response
}
