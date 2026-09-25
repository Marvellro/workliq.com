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
        .select('hub_id, status, last_error')
        .eq('customer_id', session.customerId)
        .maybeSingle(),
      supabase
        .from('slack_connections')
        .select('channel_name, team_name, status, last_error')
        .eq('customer_id', session.customerId)
        .maybeSingle(),
      supabase
        .from('notion_connections')
        .select('workspace_name, status, last_error')
        .eq('customer_id', session.customerId)
        .maybeSingle(),
    ])

  // A connection row that exists but is flagged is the state the dashboard
  // previously could not show at all: it rendered "Connected" in green while
  // every workflow using it was failing.
  function health(row: { status?: string | null; last_error?: string | null } | null) {
    return {
      needsReauth: row?.status === 'needs_reauth',
      message: row?.last_error ?? null,
    }
  }

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
  } else if (errorParam === 'hubspot_required') {
    flash = { type: 'error', message: 'Connect HubSpot before setting up workflows.' }
  } else if (errorParam) {
    flash = { type: 'error', message: 'Something went wrong. Please try again.' }
  }

  return (
    <DashboardClient
      email={session.email}
      hubspot={
        hubspotConn ? { hubId: hubspotConn.hub_id, health: health(hubspotConn) } : null
      }
      slack={
        slackConn
          ? {
              channelName: slackConn.channel_name,
              teamName: slackConn.team_name,
              health: health(slackConn),
            }
          : null
      }
      notion={
        notionConn
          ? { workspaceName: notionConn.workspace_name, health: health(notionConn) }
          : null
      }
      flash={flash}
    />
  )
}
