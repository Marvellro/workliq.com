import { redirect } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { getCustomerSession } from '@/lib/session'
import DashboardClient from './DashboardClient'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>
}) {
  const session = await getCustomerSession()
  if (!session) redirect('/dashboard/login')

  const { connected, error: errorParam } = await searchParams
  const supabase = getSupabaseAdmin()

  // Fetch all three connection statuses in parallel
  const [{ data: hubspotConn }, { data: slackConn }, { data: notionConn }] =
    await Promise.all([
      supabase
        .from('hubspot_connections')
        .select('hub_id')
        .eq('customer_id', session.customerId)
        .maybeSingle(),
      supabase
        .from('slack_connections')
        .select('channel_name, team_name')
        .eq('customer_id', session.customerId)
        .maybeSingle(),
      supabase
        .from('notion_connections')
        .select('workspace_name')
        .eq('customer_id', session.customerId)
        .maybeSingle(),
    ])

  let flash: { type: 'success' | 'error'; message: string } | null = null
  if (connected === 'hubspot') {
    flash = { type: 'success', message: 'HubSpot connected successfully.' }
  } else if (connected === 'slack') {
    flash = { type: 'success', message: 'Slack connected successfully.' }
  } else if (connected === 'notion') {
    flash = { type: 'success', message: 'Notion connected — your Stale Deals database is ready.' }
  } else if (
    errorParam === 'hubspot_denied' ||
    errorParam === 'slack_denied' ||
    errorParam === 'notion_denied'
  ) {
    flash = { type: 'error', message: 'Connection was cancelled.' }
  } else if (errorParam === 'notion_no_page') {
    flash = {
      type: 'error',
      message:
        'Notion connected but no page was shared. Please reconnect and select a page when prompted.',
    }
  } else if (errorParam) {
    flash = { type: 'error', message: 'Something went wrong. Please try again.' }
  }

  return (
    <DashboardClient
      email={session.email}
      hubspot={hubspotConn ? { hubId: hubspotConn.hub_id } : null}
      slack={
        slackConn
          ? { channelName: slackConn.channel_name, teamName: slackConn.team_name }
          : null
      }
      notion={notionConn ? { workspaceName: notionConn.workspace_name } : null}
      flash={flash}
    />
  )
}
