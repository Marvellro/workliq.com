import { NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/session'
import { getSupabaseAdmin } from '@/lib/config'
import { decrypt } from '@/lib/crypto'
import { sendSlackMessage } from '@/lib/workflow-actions'
import { ConnectionError, markConnectionUnhealthy } from '@/lib/connection-health'

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

  // Goes through the same sender the workflows use, rather than repeating the
  // POST here. That makes this button a genuine health probe in both
  // directions: a success clears a stale needs_reauth flag, and a dead webhook
  // is recorded rather than only logged — which matters because this is the
  // first thing a customer clicks when they suspect something is wrong.
  try {
    await sendSlackMessage(
      session.customerId,
      decrypt(conn.webhook_url),
      '✅ Workliq is connected to this channel.'
    )

    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof ConnectionError) {
      await markConnectionUnhealthy(err)
      // The customer is looking at the screen right now, so hand them the
      // actionable sentence instead of a generic rejection.
      return NextResponse.json({ error: err.message }, { status: 502 })
    }

    console.error('Slack test message failed:', err)
    return NextResponse.json({ error: 'Slack rejected the message' }, { status: 502 })
  }
}
