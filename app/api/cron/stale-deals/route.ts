import { NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getValidHubSpotToken } from '@/lib/hubspot'

// Vercel cron sends Authorization: Bearer {CRON_SECRET} with every invocation.
// Without this check, anyone who knows the URL could trigger the job.
const CRON_SECRET = process.env.CRON_SECRET

const NOTION_VERSION = '2022-06-28'
const MS_PER_DAY = 1000 * 60 * 60 * 24

// HubSpot deal stage IDs are internal keys (e.g. "appointmentscheduled").
// Resolving them to human-readable labels requires a pipeline API call per
// portal, which would add significant latency for many customers. For MVP we
// use the stage ID as-is and can add label resolution in a follow-up.

// ── Types ─────────────────────────────────────────────────────────────────────

type CustomerRow = {
  id: string
  stale_threshold_days: number
}

type HubSpotDeal = {
  id: string
  properties: {
    dealname: string | null
    dealstage: string | null
    hubspot_owner_id: string | null
    hs_last_activity_date: string | null  // Unix ms as a string, or null
  }
}

type HubSpotOwner = {
  id: string
  firstName: string
  lastName: string
}

type SlackConnection = {
  webhook_url: string
}

type NotionConnection = {
  access_token: string
  database_id: string
}

type AlertRow = {
  id: string
  slack_notified: boolean
  notion_logged: boolean
}

// ── Supabase ──────────────────────────────────────────────────────────────────

function getSupabaseAdmin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ── HubSpot helpers ───────────────────────────────────────────────────────────

// Fetches all deals for a portal, paginating until HubSpot signals no more pages.
// Each page returns up to 100 deals; we request only the four properties we use.
async function fetchAllDeals(accessToken: string): Promise<HubSpotDeal[]> {
  const deals: HubSpotDeal[] = []
  let after: string | null = null

  do {
    const url = new URL('https://api.hubapi.com/crm/v3/objects/deals')
    url.searchParams.set('properties', 'dealname,dealstage,hubspot_owner_id,hs_last_activity_date')
    url.searchParams.set('limit', '100')
    if (after) url.searchParams.set('after', after)

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`HubSpot deals fetch failed (${res.status}): ${body}`)
    }

    const data = await res.json() as {
      results: HubSpotDeal[]
      paging?: { next?: { after: string } }
    }

    deals.push(...data.results)
    after = data.paging?.next?.after ?? null
  } while (after !== null)

  return deals
}

// Fetches all owners for a portal and returns a map of owner_id → full name.
// One call per customer, not per deal — avoids N+1 on large deal lists.
async function fetchOwnerMap(accessToken: string): Promise<Map<string, string>> {
  const ownerMap = new Map<string, string>()

  const res = await fetch(
    'https://api.hubapi.com/crm/v3/owners?limit=100',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (!res.ok) {
    // Non-fatal — we'll fall back to the raw owner ID in the alert
    console.warn('HubSpot owners fetch failed:', res.status)
    return ownerMap
  }

  const data = await res.json() as { results: HubSpotOwner[] }
  for (const owner of data.results) {
    ownerMap.set(owner.id, `${owner.firstName} ${owner.lastName}`.trim())
  }

  return ownerMap
}

// ── Notification helpers ──────────────────────────────────────────────────────

async function postSlackAlert(
  webhookUrl: string,
  deal: HubSpotDeal,
  daysStale: number,
  threshold: number,
  hubId: string,
  ownerName: string
): Promise<void> {
  const dealName = deal.properties.dealname ?? 'Unnamed deal'
  const stage    = deal.properties.dealstage ?? 'Unknown stage'
  const hubLink  = `https://app.hubspot.com/contacts/${hubId}/deal/${deal.id}`

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: [
        `⚠️ *Stale deal alert* — ${dealName}`,
        `Stage: ${stage}`,
        `Owner: ${ownerName}`,
        `Days since last activity: *${daysStale}* (threshold: ${threshold})`,
        `<${hubLink}|View in HubSpot>`,
      ].join('\n'),
    }),
  })

  // Incoming webhooks always return HTTP 200 with text body "ok" on success.
  // Any non-200 is a genuine delivery failure.
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Slack webhook returned ${res.status}: ${body}`)
  }
}

async function createNotionRow(
  conn: NotionConnection,
  deal: HubSpotDeal,
  daysStale: number,
  threshold: number,
  hubId: string,
  ownerName: string
): Promise<void> {
  const dealName = deal.properties.dealname ?? 'Unnamed deal'
  const stage    = deal.properties.dealstage ?? 'Unknown'
  const hubLink  = `https://app.hubspot.com/contacts/${hubId}/deal/${deal.id}`
  const today    = new Date().toISOString().split('T')[0] // YYYY-MM-DD

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${conn.access_token}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: JSON.stringify({
      parent: { database_id: conn.database_id },
      properties: {
        'Deal Name':    { title:     [{ text: { content: dealName } }] },
        'Stage':        { select:    { name: stage } },
        'Owner':        { rich_text: [{ text: { content: ownerName } }] },
        'Days Stale':   { number:    daysStale },
        'Threshold':    { select:    { name: String(threshold) } },
        'Flagged On':   { date:      { start: today } },
        'HubSpot Link': { url:       hubLink },
        // Status is set to "New" at creation and never overwritten — the customer
        // owns this field for their own triage workflow. See spec §5.
        'Status':       { select:    { name: 'New' } },
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Notion page creation returned ${res.status}: ${body}`)
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  // Verify the Vercel cron secret before doing any work
  const authHeader = req.headers.get('authorization')
console.log('[debug] CRON_SECRET set:', !!CRON_SECRET, 'CRON_SECRET length:', CRON_SECRET?.length)
console.log('[debug] authHeader length:', authHeader?.length)
console.log('[debug] authHeader starts with Bearer:', authHeader?.startsWith('Bearer '))
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()
  const runAt = new Date().toISOString()
  console.log(`[stale-deals] cron run started at ${runAt}`)

  // Fetch all customers who have a HubSpot connection — they're the ones we
  // can actually run deals checks for. We join in one query rather than
  // fetching customers then filtering, to avoid loading the full customers table.
  const { data: customers, error: customerErr } = await supabase
    .from('customers')
    .select(`
      id,
      stale_threshold_days,
      hubspot_connections ( hub_id ),
      slack_connections ( webhook_url ),
      notion_connections ( access_token, database_id )
    `)
    // Only process customers who have actually connected HubSpot — no point
    // fetching deals if we can't authenticate against their portal.
    .not('hubspot_connections', 'is', null)

  if (customerErr) {
    console.error('[stale-deals] Failed to load customers:', customerErr)
    return NextResponse.json({ error: 'Failed to load customers' }, { status: 500 })
  }

  if (!customers || customers.length === 0) {
    console.log('[stale-deals] No customers with HubSpot connections — nothing to do')
    return NextResponse.json({ ok: true, processed: 0 })
  }

  let totalAlerts = 0

  // Process each customer independently. An error for one customer is logged
  // and skipped — it must not prevent other customers from being processed.
  for (const customer of customers) {
    const customerId = customer.id
    const threshold  = customer.stale_threshold_days

    // Supabase returns nested relations as an object (single) or array.
    // maybeSingle() isn't available in select joins, so we normalise here.
    const hubspotConn   = Array.isArray(customer.hubspot_connections)
      ? customer.hubspot_connections[0]
      : customer.hubspot_connections
    const slackConn     = Array.isArray(customer.slack_connections)
      ? customer.slack_connections[0]
      : customer.slack_connections
    const notionConn    = Array.isArray(customer.notion_connections)
      ? customer.notion_connections[0]
      : customer.notion_connections

    if (!hubspotConn) {
      // Belt-and-suspenders: the outer query filters on .not('hubspot_connections', 'is', null)
      // but the join can still return null if the row was deleted between queries.
      console.warn(`[stale-deals] customer ${customerId}: no HubSpot connection after join — skipping`)
      continue
    }

    const hubId = hubspotConn.hub_id

    // ── Step 1: Get a valid HubSpot access token (refresh if needed) ─────────
    let accessToken: string
    try {
      accessToken = await getValidHubSpotToken(customerId)
    } catch (err) {
      console.error(`[stale-deals] customer ${customerId}: token refresh failed —`, err)
      continue
    }

    // ── Step 2: Fetch all deals and the owner name map ───────────────────────
    let deals: HubSpotDeal[]
    let ownerMap: Map<string, string>
    try {
      ;[deals, ownerMap] = await Promise.all([
        fetchAllDeals(accessToken),
        fetchOwnerMap(accessToken),
      ])
    } catch (err) {
      console.error(`[stale-deals] customer ${customerId}: deal/owner fetch failed —`, err)
      continue
    }

    console.log(`[stale-deals] customer ${customerId}: ${deals.length} deals, threshold ${threshold}d`)

    // ── Step 3: Evaluate each deal ───────────────────────────────────────────
    for (const deal of deals) {
      const lastActivityMs = deal.properties.hs_last_activity_date
        ? parseInt(deal.properties.hs_last_activity_date, 10)
        : null

      // If HubSpot has no activity date for this deal we can't compute staleness
      // — skip rather than treating it as infinitely stale.
      if (lastActivityMs === null || isNaN(lastActivityMs)) continue

      const daysStale = Math.floor((Date.now() - lastActivityMs) / MS_PER_DAY)
      if (daysStale < threshold) continue

      const ownerName = deal.properties.hubspot_owner_id
        ? (ownerMap.get(deal.properties.hubspot_owner_id) ?? deal.properties.hubspot_owner_id)
        : 'Unknown'

      // ── Dedup: find-or-create the deal_alerts row ─────────────────────────
      // The unique constraint on (customer_id, deal_id, threshold) means this
      // upsert is a no-op if an alert already exists for this exact
      // deal+threshold combination, preserving the existing slack_notified /
      // notion_logged flags so we don't re-fire channels that already succeeded.
      const { data: alert, error: upsertErr } = await supabase
        .from('deal_alerts')
        .upsert(
          { customer_id: customerId, deal_id: deal.id, threshold },
          { onConflict: 'customer_id,deal_id,threshold', ignoreDuplicates: false }
        )
        .select('id, slack_notified, notion_logged')
        .single() as { data: AlertRow | null; error: unknown }

      if (upsertErr || !alert) {
        console.error(
          `[stale-deals] customer ${customerId} deal ${deal.id}: alert upsert failed —`,
          upsertErr
        )
        continue
      }

      // ── Slack notification ────────────────────────────────────────────────
      // Independent of Notion — a failure here does not block Notion, and vice
      // versa. Only retried if slack_notified is still false on the next run.
      if (!alert.slack_notified && slackConn) {
        try {
          await postSlackAlert(
            (slackConn as SlackConnection).webhook_url,
            deal,
            daysStale,
            threshold,
            hubId,
            ownerName
          )

          const { error: updateErr } = await supabase
            .from('deal_alerts')
            .update({ slack_notified: true })
            .eq('id', alert.id)

          if (updateErr) {
            // The Slack message was sent but we failed to record it. On the next
            // run we'll attempt to send again and Slack will receive a duplicate.
            // This is the safer failure mode (duplicate alert) vs. silent miss.
            console.error(
              `[stale-deals] customer ${customerId} deal ${deal.id}: failed to mark slack_notified —`,
              updateErr
            )
          } else {
            console.log(`[stale-deals] customer ${customerId} deal ${deal.id}: Slack notified`)
            totalAlerts++
          }
        } catch (err) {
          // Leave slack_notified = false so the next cron run retries
          console.error(
            `[stale-deals] customer ${customerId} deal ${deal.id}: Slack send failed —`,
            err
          )
        }
      }

      // ── Notion logging ────────────────────────────────────────────────────
      if (!alert.notion_logged && notionConn) {
        try {
          await createNotionRow(
            notionConn as NotionConnection,
            deal,
            daysStale,
            threshold,
            hubId,
            ownerName
          )

          const { error: updateErr } = await supabase
            .from('deal_alerts')
            .update({ notion_logged: true })
            .eq('id', alert.id)

          if (updateErr) {
            // Same reasoning as the Slack case above — prefer a duplicate Notion
            // row on the next run over silently missing the log entry.
            console.error(
              `[stale-deals] customer ${customerId} deal ${deal.id}: failed to mark notion_logged —`,
              updateErr
            )
          } else {
            console.log(`[stale-deals] customer ${customerId} deal ${deal.id}: Notion logged`)
            totalAlerts++
          }
        } catch (err) {
          // Leave notion_logged = false so the next cron run retries
          console.error(
            `[stale-deals] customer ${customerId} deal ${deal.id}: Notion write failed —`,
            err
          )
        }
      }
    }
  }

  console.log(`[stale-deals] run complete — ${totalAlerts} notifications sent`)
  return NextResponse.json({ ok: true, alerts: totalAlerts })
}
