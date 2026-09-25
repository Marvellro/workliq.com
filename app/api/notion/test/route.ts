import { NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/session'
import { getSupabaseAdmin } from '@/lib/config'
import { decrypt } from '@/lib/crypto'
import { createNotionPage } from '@/lib/workflow-actions'
import { ConnectionError, markConnectionUnhealthy } from '@/lib/connection-health'

export async function POST() {
  const session = await getCustomerSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Fetch the customer's Notion connection — access_token and database_id
  // never leave the server
  const { data: conn, error: fetchError } = await getSupabaseAdmin()
    .from('notion_connections')
    .select('access_token, database_id')
    .eq('customer_id', session.customerId)
    .single()

  if (fetchError || !conn) {
    return NextResponse.json({ error: 'No Notion connection found' }, { status: 404 })
  }

  // Insert a clearly-labelled sample row so the customer can see it immediately
  // in their Notion database and confirm the connection is working.
  // Status is set to "New" here — same as what the cron job will do on real rows.
  //
  // Goes through the same writer the workflows use. See the Slack test route
  // for why: this button is the customer's own health check, so it should
  // update the recorded health rather than sit outside it.
  try {
    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD

    await createNotionPage(
      session.customerId,
      { access_token: decrypt(conn.access_token), database_id: conn.database_id },
      {
        'Deal Name':    { title:     [{ text: { content: 'Test Deal (Workliq)' } }] },
        'Stage':        { select:    { name: 'Demo Scheduled' } },
        'Owner':        { rich_text: [{ text: { content: 'Workliq Test' } }] },
        'Days Stale':   { number:    7 },
        'Threshold':    { select:    { name: '7' } },
        'Flagged On':   { date:      { start: today } },
        'HubSpot Link': { url:       'https://app.hubspot.com' },
        'Status':       { select:    { name: 'New' } },
      }
    )

    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof ConnectionError) {
      await markConnectionUnhealthy(err)
      return NextResponse.json({ error: err.message }, { status: 502 })
    }

    console.error('Notion test row creation failed:', err)
    return NextResponse.json({ error: 'Notion rejected the request' }, { status: 502 })
  }
}
