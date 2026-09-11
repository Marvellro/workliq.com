import { NextResponse, after } from 'next/server'
import { getSupabaseAdmin, APP_URL } from '@/lib/config'
import {
  verifyHubSpotSignature,
  buildSignedUri,
  parseWebhookBatch,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from '@/lib/hubspot-signature'
import { enqueue, runJobs } from '@/lib/jobs'
import { registerJobHandlers } from '@/lib/job-handlers'

// Inbound HubSpot webhooks.
//
// This replaces waiting up to 24 hours for the next cron poll with reacting in
// seconds. HubSpot allows roughly five seconds to respond and re-sends the
// whole batch if we are slower, so this handler does the minimum possible:
// verify, record, enqueue, return 200. All real work happens in the job queue.
//
// Setup on HubSpot's side (see MIGRATION.md): add this URL as the webhook
// target in the app's settings and subscribe to deal.creation and
// deal.propertyChange.

export const dynamic = 'force-dynamic'
// after() runs inside this route's duration budget, so the ceiling has to cover
// acknowledging HubSpot *and* draining the queue behind it.
export const maxDuration = 60

// HubSpot batches up to 100 events per delivery.
const MAX_BATCH = 100

export async function POST(req: Request) {
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET
  if (!clientSecret) {
    console.error('[webhooks/hubspot] HUBSPOT_CLIENT_SECRET is not set')
    // 500 so HubSpot retries: this is our misconfiguration, not a bad request,
    // and the events are still worth receiving once it's fixed.
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }

  // Read the raw text, never req.json(). Parsing and re-serialising changes the
  // bytes and the signature would never match.
  const body = await req.text()

  const url = new URL(req.url)
  const check = verifyHubSpotSignature({
    method: 'POST',
    uri: buildSignedUri(APP_URL, url.pathname, url.search),
    body,
    signature: req.headers.get(SIGNATURE_HEADER),
    timestamp: req.headers.get(TIMESTAMP_HEADER),
    clientSecret,
  })

  if (!check.valid) {
    console.warn(`[webhooks/hubspot] rejected: ${check.reason}`)
    // 401, deliberately: a signature that doesn't verify will not verify on
    // retry either, and telling HubSpot to keep re-sending a request we will
    // keep rejecting helps nobody.
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const events = parseWebhookBatch(body).slice(0, MAX_BATCH)
  if (events.length === 0) {
    return NextResponse.json({ ok: true, received: 0 })
  }

  const supabase = getSupabaseAdmin()

  // Map portals to customers in one query rather than per event — a batch of
  // 100 events is usually a handful of portals.
  const portalIds = [...new Set(events.map((e) => String(e.portalId)))]
  const { data: connections, error: connError } = await supabase
    .from('hubspot_connections')
    .select('customer_id, hub_id')
    .in('hub_id', portalIds)

  if (connError) {
    console.error('[webhooks/hubspot] connection lookup failed:', connError.message)
    // Transient — let HubSpot retry rather than silently dropping real events.
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }

  const portalToCustomer = new Map<string, string>()
  for (const c of connections ?? []) portalToCustomer.set(c.hub_id, c.customer_id)

  const rows = events.map((e) => ({
    customer_id: portalToCustomer.get(String(e.portalId)) ?? null,
    portal_id: String(e.portalId),
    // eventId is documented as not guaranteed unique, so it is part of a
    // composite key rather than the key itself.
    event_id: String(e.eventId ?? `${e.objectId}-${e.occurredAt}`),
    subscription_type: e.subscriptionType,
    object_id: String(e.objectId),
    property_name: e.propertyName ?? null,
    property_value: e.propertyValue ?? null,
    occurred_at: new Date(e.occurredAt).toISOString(),
    raw: e as unknown as Record<string, unknown>,
  }))

  // ignoreDuplicates: a redelivered batch (because a previous response was
  // slow) must be a no-op, not a second round of customer notifications.
  const { data: inserted, error: insertError } = await supabase
    .from('hubspot_events')
    .upsert(rows, {
      onConflict: 'portal_id,event_id,subscription_type,object_id,occurred_at',
      ignoreDuplicates: true,
    })
    .select('id, customer_id')

  if (insertError) {
    console.error('[webhooks/hubspot] event insert failed:', insertError.message)
    return NextResponse.json({ error: 'Store failed' }, { status: 500 })
  }

  // Only genuinely new events come back from an ignoreDuplicates upsert, so
  // this enqueues once per real event even across redeliveries.
  const fresh = inserted ?? []
  let queued = 0

  for (const row of fresh) {
    if (!row.customer_id) continue // event for a portal we have no connection to
    try {
      const id = await enqueue({
        kind: 'hubspot.event',
        customerId: row.customer_id,
        payload: { eventId: row.id },
        idempotencyKey: `hubspot.event:${row.id}`,
      })
      if (id) queued++
    } catch (err) {
      // Don't fail the response over one enqueue: the event row is already
      // durable, and the reconciliation sweep picks up anything unprocessed.
      console.error('[webhooks/hubspot] enqueue failed for event', row.id, err)
    }
  }

  console.log(
    `[webhooks/hubspot] ${events.length} received, ${fresh.length} new, ${queued} queued`
  )

  // Drain the queue after the response is sent.
  //
  // This is what makes delivery real-time without a per-minute cron: HubSpot
  // gets its acknowledgement inside the ~5s budget, and the actual Slack /
  // Notion / webhook delivery runs immediately afterwards in this same
  // invocation. See lib/scheduling.md — the Hobby plan caps cron at once per
  // day, so nothing time-sensitive may depend on a scheduler.
  //
  // The worker claims every runnable job, not just the ones queued above, so
  // this also picks up retries that have come due.
  if (queued > 0) {
    after(async () => {
      try {
        registerJobHandlers()
        const result = await runJobs({ budgetMs: 40_000, batchSize: 20 })
        if (result.claimed > 0) {
          console.log(
            `[webhooks/hubspot] drained ${result.claimed}: ${result.succeeded} ok, ` +
              `${result.retried} retrying, ${result.dead} dead`
          )
        }
      } catch (err) {
        // Never surface this: the response has already gone. The jobs stay
        // queued and the daily worker will pick them up regardless.
        console.error('[webhooks/hubspot] post-response drain failed:', err)
      }
    })
  }

  return NextResponse.json({ ok: true, received: events.length, queued })
}
