import { NextResponse, after } from 'next/server'
import Stripe from 'stripe'
import { getSupabaseAdmin } from '@/lib/config'
import { enqueue, runJobs } from '@/lib/jobs'
import { registerJobHandlers } from '@/lib/job-handlers'

// Inbound Stripe webhooks.
//
// This is the piece that was missing entirely: Checkout worked and money moved,
// but nothing ever wrote down what a customer had bought, so `customers.plan`
// stayed null forever and no limit could be enforced.
//
// Same shape as the HubSpot receiver — verify, record, enqueue, return 200 —
// for the same reason: Stripe retries anything slow or failed, and doing the
// work inline means a slow database turns into duplicate deliveries.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Only the events that actually change what an account is entitled to.
// Stripe's own guidance is to subscribe narrowly: listening to everything puts
// load on the endpoint for events that are then discarded.
const HANDLED_EVENTS = new Set<string>([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
])

export async function POST(req: Request) {
  const secret = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!secret || !webhookSecret) {
    console.error('[webhooks/stripe] STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET is not set')
    // 500 so Stripe retries — this is our misconfiguration, and these events
    // are worth receiving once it's fixed.
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }

  // Raw text, never req.json(). Stripe signs the exact bytes; parsing and
  // re-serialising changes them and verification fails.
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  const stripe = new Stripe(secret, { apiVersion: '2026-05-27.dahlia' })

  let event: Stripe.Event
  try {
    // constructEventAsync, not constructEvent: the async variant uses Web
    // Crypto, which is what's available in this serverless runtime.
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[webhooks/stripe] signature verification failed:', message)
    // 400, deliberately: a signature that doesn't verify won't verify on retry.
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    // Acknowledge so Stripe stops sending it, but do no work.
    return NextResponse.json({ ok: true, ignored: event.type })
  }

  const supabase = getSupabaseAdmin()

  // Record before processing. The unique constraint on stripe_event_id is what
  // makes redelivery a no-op — without it, a resent
  // `customer.subscription.deleted` could downgrade an account that has since
  // resubscribed.
  const { data: inserted, error } = await supabase
    .from('stripe_events')
    .upsert(
      {
        stripe_event_id: event.id,
        type: event.type,
        raw: event as unknown as Record<string, unknown>,
      },
      { onConflict: 'stripe_event_id', ignoreDuplicates: true }
    )
    .select('id')

  if (error) {
    console.error('[webhooks/stripe] event insert failed:', error.message)
    return NextResponse.json({ error: 'Store failed' }, { status: 500 })
  }

  const fresh = inserted ?? []
  if (fresh.length === 0) {
    // Already seen. Acknowledge without re-queueing.
    return NextResponse.json({ ok: true, duplicate: true })
  }

  await enqueue({
    kind: 'stripe.event',
    payload: { eventId: fresh[0].id },
    idempotencyKey: `stripe.event:${fresh[0].id}`,
  }).catch((err) => {
    // The event row is durable either way; the daily worker sweeps unprocessed.
    console.error('[webhooks/stripe] enqueue failed:', err)
  })

  // Apply it immediately rather than waiting for the next worker run — a
  // customer who has just paid should not sit on the free plan. See
  // lib/scheduling.md for why nothing here depends on cron.
  after(async () => {
    try {
      registerJobHandlers()
      await runJobs({ budgetMs: 30_000, batchSize: 10 })
    } catch (err) {
      console.error('[webhooks/stripe] post-response drain failed:', err)
    }
  })

  return NextResponse.json({ ok: true, type: event.type })
}
