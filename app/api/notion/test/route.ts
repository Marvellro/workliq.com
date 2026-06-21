import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCustomerSession } from '@/lib/session'

const NOTION_VERSION = '2022-06-28'

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
  try {
    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD

    const pageRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conn.access_token}`,
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_VERSION,
      },
      body: JSON.stringify({
        parent: { database_id: conn.database_id },
        properties: {
          'Deal Name':    { title:     [{ text: { content: 'Test Deal (Workliq)' } }] },
          'Stage':        { select:    { name: 'Demo Scheduled' } },
          'Owner':        { rich_text: [{ text: { content: 'Workliq Test' } }] },
          'Days Stale':   { number:    7 },
          'Threshold':    { select:    { name: '7' } },
          'Flagged On':   { date:      { start: today } },
          'HubSpot Link': { url:       'https://app.hubspot.com' },
          'Status':       { select:    { name: 'New' } },
        },
      }),
    })

    if (!pageRes.ok) {
      const errText = await pageRes.text()
      console.error('Notion test row creation failed:', pageRes.status, errText)
      return NextResponse.json({ error: 'Notion rejected the request' }, { status: 502 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Notion test row network error:', err)
    return NextResponse.json({ error: 'Failed to reach Notion' }, { status: 502 })
  }
}
