import { NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getValidHubSpotToken } from '@/lib/hubspot'
import { fetchAllDeals, fetchOwnerMap } from '@/lib/hubspot-deals'
import { runWorkflowsForCustomer, type WorkflowRow } from '@/lib/workflow-engine'

// Vercel cron sends Authorization: Bearer {CRON_SECRET} with every invocation.
const CRON_SECRET = process.env.CRON_SECRET

function getSupabaseAdmin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()
  const runAt = new Date().toISOString()
  console.log(`[workflows] cron run started at ${runAt}`)

  // Only customers with a HubSpot connection AND at least one enabled workflow
  // are worth fetching deals for — everyone else costs an API call for nothing.
  const { data: customers, error: customerErr } = await supabase
    .from('customers')
    .select(`
      id,
      hubspot_connections ( hub_id ),
      slack_connections ( webhook_url ),
      notion_connections ( access_token, database_id ),
      workflows ( id, name, trigger_type, trigger_config, condition_property, condition_operator, condition_value, action_type, action_config, enabled )
    `)
    .not('hubspot_connections', 'is', null)

  if (customerErr) {
    console.error('[workflows] Failed to load customers:', customerErr)
    return NextResponse.json({ error: 'Failed to load customers' }, { status: 500 })
  }

  if (!customers || customers.length === 0) {
    console.log('[workflows] No customers with HubSpot connections — nothing to do')
    return NextResponse.json({ ok: true, processed: 0 })
  }

  let totalFired = 0
  let totalFailed = 0
  let customersProcessed = 0

  for (const customer of customers) {
    const customerId = customer.id

    const hubspotConn = Array.isArray(customer.hubspot_connections)
      ? customer.hubspot_connections[0]
      : customer.hubspot_connections
    const slackConn = Array.isArray(customer.slack_connections)
      ? customer.slack_connections[0]
      : customer.slack_connections
    const notionConn = Array.isArray(customer.notion_connections)
      ? customer.notion_connections[0]
      : customer.notion_connections
    const workflows = (customer.workflows ?? []) as WorkflowRow[]

    if (!hubspotConn) continue

    const enabledWorkflows = workflows.filter((w) => w.enabled)
    if (enabledWorkflows.length === 0) continue

    let accessToken: string
    try {
      accessToken = await getValidHubSpotToken(customerId)
    } catch (err) {
      console.error(`[workflows] customer ${customerId}: token refresh failed —`, err)
      continue
    }

    let deals
    let ownerMap
    try {
      ;[deals, ownerMap] = await Promise.all([
        fetchAllDeals(accessToken),
        fetchOwnerMap(accessToken),
      ])
    } catch (err) {
      console.error(`[workflows] customer ${customerId}: deal/owner fetch failed —`, err)
      continue
    }

    try {
      const { fired, failed } = await runWorkflowsForCustomer({
        supabase,
        customerId,
        hubId: hubspotConn.hub_id,
        deals,
        ownerMap,
        workflows: enabledWorkflows,
        slackConn: slackConn ?? null,
        notionConn: notionConn ?? null,
      })
      totalFired += fired
      totalFailed += failed
      customersProcessed++
      console.log(`[workflows] customer ${customerId}: ${fired} fired, ${failed} failed, ${deals.length} deals checked`)
    } catch (err) {
      console.error(`[workflows] customer ${customerId}: engine run failed —`, err)
    }
  }

  console.log(`[workflows] run complete — ${customersProcessed} customers, ${totalFired} fired, ${totalFailed} failed`)
  return NextResponse.json({ ok: true, customersProcessed, fired: totalFired, failed: totalFailed })
}
