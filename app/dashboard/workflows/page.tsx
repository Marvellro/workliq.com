import { redirect } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { getCustomerSession } from '@/lib/session'
import WorkflowsClient from './WorkflowsClient'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export default async function WorkflowsPage() {
  const session = await getCustomerSession()
  if (!session) redirect('/dashboard/login')

  const supabase = getSupabaseAdmin()

  const [{ data: workflows }, { data: hubspotConn }, { data: slackConn }, { data: notionConn }] =
    await Promise.all([
      supabase
        .from('workflows')
        .select('*')
        .eq('customer_id', session.customerId)
        .order('created_at', { ascending: false }),
      supabase
        .from('hubspot_connections')
        .select('hub_id')
        .eq('customer_id', session.customerId)
        .maybeSingle(),
      supabase
        .from('slack_connections')
        .select('channel_name')
        .eq('customer_id', session.customerId)
        .maybeSingle(),
      supabase
        .from('notion_connections')
        .select('workspace_name')
        .eq('customer_id', session.customerId)
        .maybeSingle(),
    ])

  // Workflows depend on a HubSpot connection to have any deals to evaluate —
  // send customers back to Connections if they haven't set that up yet.
  if (!hubspotConn) redirect('/dashboard?error=hubspot_required')

  return (
    <WorkflowsClient
      initialWorkflows={workflows ?? []}
      slackConnected={!!slackConn}
      notionConnected={!!notionConn}
    />
  )
}
