import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCustomerSession } from '@/lib/session'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST() {
  const session = await getCustomerSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Fetch the customer's webhook URL — never expose it to the client
  const { data: conn, error: fetchError } = await getSupabaseAdmin()
    .from('slack_connections')
    .select('webhook_url, channel_name, team_name')
    .eq('customer_id', session.customerId)
    .single()

  if (fetchError || !conn) {
    return NextResponse.json({ error: 'No Slack connection found' }, { status: 404 })
  }

  // POST the test message directly to the incoming webhook URL
  try {
    const slackRes = await fetch(conn.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '✅ Workliq is connected to this channel.',
      }),
    })

    // Slack incoming webhooks return plain text "ok" on success, not JSON
    if (!slackRes.ok) {
      const body = await slackRes.text()
      console.error('Slack test message failed:', slackRes.status, body)
      return NextResponse.json({ error: 'Slack rejected the message' }, { status: 502 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Slack test message network error:', err)
    return NextResponse.json({ error: 'Failed to reach Slack' }, { status: 502 })
  }
}
