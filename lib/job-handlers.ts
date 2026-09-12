import { getSupabaseAdmin } from './config'
import { registerHandler, enqueue, PermanentJobError, type JobRecord } from './jobs'
import { executeWorkflowAction, isActionPayload, type ActionPayload } from './workflow-execute'
import { workflowMatchesCondition, type WorkflowRow, type TriggerEvent } from './workflow-engine'
import { getValidHubSpotToken } from './hubspot'
import {
  syncAiBudgetToPlan,
  planFromId,
  isPaidStatus,
  planForPriceId,
  hasPriceTable,
  type PlanId,
} from './plans'
import type Stripe from 'stripe'
import { fetchDeal, fetchOwnerMap } from './hubspot-deals'

// Registers every job handler.
//
// Imported for side effects by each entry point that runs jobs. Registration
// lives in one module rather than at each definition site so there is a single
// place to see what the worker can execute — and so a handler can never be
// half-registered depending on which route happened to import what.

let registered = false

export function registerJobHandlers(): void {
  if (registered) return
  registered = true

  registerHandler('workflow.action', handleWorkflowAction)
  registerHandler('hubspot.event', handleHubSpotEvent)
  registerHandler('stripe.event', handleStripeEvent)
  registerHandler('maintenance.purge', handleMaintenancePurge)
}

// ── workflow.action ──────────────────────────────────────────────────────────

async function handleWorkflowAction(job: JobRecord): Promise<void> {
  if (!isActionPayload(job.payload)) {
    // Malformed payloads don't become well-formed on retry.
    throw new PermanentJobError('workflow.action payload is malformed')
  }
  await executeWorkflowAction(job.payload)
}

// ── hubspot.event ────────────────────────────────────────────────────────────

// HubSpot subscription types we act on. Anything else is recorded and marked
// processed without further work, so an over-broad subscription in the HubSpot
// app doesn't generate noise or dead jobs.
const DEAL_CREATED = 'deal.creation'
const DEAL_PROPERTY_CHANGE = 'deal.propertyChange'

async function handleHubSpotEvent(job: JobRecord): Promise<void> {
  const eventId = job.payload.eventId
  if (typeof eventId !== 'string') {
    throw new PermanentJobError('hubspot.event payload is missing eventId')
  }

  const supabase = getSupabaseAdmin()

  const { data: event, error } = await supabase
    .from('hubspot_events')
    .select('*')
    .eq('id', eventId)
    .maybeSingle()

  if (error) throw new Error(`Could not load event: ${error.message}`)
  if (!event) throw new PermanentJobError(`Event ${eventId} no longer exists`)
  if (event.processed_at) return // already handled; retry is a no-op
  if (!event.customer_id) {
    // A portal we hold no connection for — nothing to do, but mark it handled
    // so it doesn't linger as unprocessed forever.
    await markProcessed(eventId)
    return
  }

  const customerId = event.customer_id as string
  const dealId = event.object_id as string

  // Only stage changes and creations map to a trigger today.
  const isStageChange =
    event.subscription_type === DEAL_PROPERTY_CHANGE && event.property_name === 'dealstage'
  const isCreation = event.subscription_type === DEAL_CREATED

  if (!isStageChange && !isCreation) {
    await markProcessed(eventId)
    return
  }

  const { data: workflows } = await supabase
    .from('workflows')
    .select('*')
    .eq('customer_id', customerId)
    .eq('enabled', true)

  const candidates = ((workflows ?? []) as WorkflowRow[]).filter((w) =>
    isCreation ? w.trigger_type === 'deal_created' : w.trigger_type === 'deal_stage_changed'
  )

  // Snapshot is kept current even when no workflow is interested, so the
  // reconciliation sweep doesn't later mistake this for an unseen change.
  if (candidates.length === 0) {
    await upsertSnapshot(customerId, dealId, (event.property_value as string) ?? null)
    await markProcessed(eventId)
    return
  }

  const { data: conn } = await supabase
    .from('hubspot_connections')
    .select('hub_id')
    .eq('customer_id', customerId)
    .maybeSingle()

  if (!conn) throw new PermanentJobError('Customer has no HubSpot connection')

  // The notification carries only the object ID and the changed property; a
  // useful alert also needs the deal's name and owner.
  const accessToken = await getValidHubSpotToken(customerId)
  const [deal, ownerMap] = await Promise.all([
    fetchDeal(accessToken, dealId),
    fetchOwnerMap(accessToken),
  ])

  if (!deal) {
    // Deleted between the event and now — expected, not an error.
    await markProcessed(eventId)
    return
  }

  const currentStage = deal.properties.dealstage
  const triggerEvent: TriggerEvent = isCreation
    ? { type: 'deal_created', fingerprint: dealId }
    : {
        type: 'deal_stage_changed',
        fingerprint: `${dealId}:${currentStage}`,
        newStage: currentStage ?? '',
      }

  const ownerName = deal.properties.hubspot_owner_id
    ? ownerMap.get(deal.properties.hubspot_owner_id) ?? deal.properties.hubspot_owner_id
    : 'Unassigned'

  let queued = 0
  for (const workflow of candidates) {
    // Stage-specific workflows only fire for their configured target stage.
    if (
      triggerEvent.type === 'deal_stage_changed' &&
      workflow.trigger_config.to_stage &&
      workflow.trigger_config.to_stage !== triggerEvent.newStage
    ) {
      continue
    }
    if (!workflowMatchesCondition(workflow, deal, ownerMap)) continue

    const payload: ActionPayload = {
      workflowId: workflow.id,
      customerId,
      hubId: conn.hub_id,
      dealId,
      dealName: deal.properties.dealname,
      dealStage: currentStage,
      ownerName,
      event: triggerEvent,
    }

    // Same key shape the reconciliation sweep uses, so an event observed by
    // both paths results in exactly one delivery.
    const id = await enqueue({
      kind: 'workflow.action',
      customerId,
      payload: payload as unknown as Record<string, unknown>,
      idempotencyKey: `workflow.action:${workflow.id}:${dealId}:${triggerEvent.fingerprint}`,
    })
    if (id) queued++
  }

  await upsertSnapshot(customerId, dealId, currentStage)
  await markProcessed(eventId)

  console.log(`[hubspot.event] ${event.subscription_type} deal ${dealId}: ${queued} action(s) queued`)
}

async function markProcessed(eventId: string): Promise<void> {
  await getSupabaseAdmin()
    .from('hubspot_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', eventId)
}

async function upsertSnapshot(
  customerId: string,
  dealId: string,
  stage: string | null
): Promise<void> {
  await getSupabaseAdmin()
    .from('deal_snapshots')
    .upsert(
      {
        customer_id: customerId,
        deal_id: dealId,
        last_stage: stage,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'customer_id,deal_id' }
    )
}

// ── stripe.event ─────────────────────────────────────────────────────────────

async function handleStripeEvent(job: JobRecord): Promise<void> {
  const eventId = job.payload.eventId
  if (typeof eventId !== 'string') {
    throw new PermanentJobError('stripe.event payload is missing eventId')
  }

  const supabase = getSupabaseAdmin()

  const { data: row, error } = await supabase
    .from('stripe_events')
    .select('*')
    .eq('id', eventId)
    .maybeSingle()

  if (error) throw new Error(`Could not load Stripe event: ${error.message}`)
  if (!row) throw new PermanentJobError(`Stripe event ${eventId} no longer exists`)
  if (row.processed_at) return // already applied; retry is a no-op

  const event = row.raw as Stripe.Event

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      // Checkout only tells us a purchase happened. The subscription events
      // carry the authoritative state (status, period end, cancellation), so
      // this is recorded but the plan is set from those.
      console.log(
        `[stripe.event] checkout completed for ${session.customer_details?.email ?? 'unknown'}`
      )
      break
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      await applySubscription(event.data.object as Stripe.Subscription, event.type)
      break
    }

    case 'invoice.payment_failed': {
      // Not a downgrade on its own. Stripe moves the subscription to past_due
      // (or later unpaid/canceled) and sends a subscription.updated for that,
      // which is what actually changes entitlements. Downgrading here as well
      // would cut someone off during the retry window they are entitled to.
      const invoice = event.data.object as Stripe.Invoice
      console.warn(
        `[stripe.event] payment failed for customer ${invoice.customer} — awaiting subscription status change`
      )
      break
    }
  }

  await supabase
    .from('stripe_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', eventId)
}

/**
 * Decides which plan a subscription grants.
 *
 * The price the customer is actually billed for wins over
 * `subscription.metadata`, which the checkout route writes once and never
 * updates. A Billing Portal upgrade changes the price and leaves the metadata
 * stale, so trusting metadata would mean charging someone for Growth while
 * giving them Starter.
 *
 * Metadata remains the fallback for subscriptions created through our own
 * checkout before this existed, and for the case where the price environment
 * variables are not configured at all.
 */
function resolvePlan(subscription: Stripe.Subscription): {
  plan: PlanId
  billingPeriod: string | null
} {
  // A subscription can carry several items. Take the first one that matches a
  // price we recognise, rather than blindly the first item — an added one-off
  // or add-on line should not decide the plan.
  for (const item of subscription.items?.data ?? []) {
    const mapped = planForPriceId(item.price?.id)
    if (mapped) return { plan: mapped.plan, billingPeriod: mapped.billingPeriod }
  }

  const metadataPlan = subscription.metadata?.plan
  const priceIds = (subscription.items?.data ?? []).map((i) => i.price?.id).filter(Boolean)

  if (!hasPriceTable()) {
    // No STRIPE_PRICE_* variables are set at all, so nothing could have matched.
    console.error(
      '[stripe.event] no STRIPE_PRICE_* variables configured — falling back to subscription metadata. ' +
        'Set them so plan changes made in the Stripe Billing Portal are honoured.'
    )
  } else if (priceIds.length > 0) {
    // Configured, but this price is not one of ours. Someone is paying for
    // something we do not recognise; that must be visible, not silently free.
    console.error(
      `[stripe.event] subscription ${subscription.id} uses unrecognised price(s) ` +
        `${priceIds.join(', ')} — check STRIPE_PRICE_* match the account these were bought in. ` +
        `Falling back to metadata (${metadataPlan ?? 'none'}).`
    )
  }

  return {
    plan: planFromId(metadataPlan),
    billingPeriod: subscription.metadata?.billing ?? null,
  }
}

async function applySubscription(
  subscription: Stripe.Subscription,
  eventType: string
): Promise<void> {
  const supabase = getSupabaseAdmin()

  // The payer's email. Stripe puts it in different places depending on how the
  // subscription was created, so try each.
  const stripeCustomerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id

  let email: string | null = null
  if (stripeCustomerId) {
    const { data: existing } = await supabase
      .from('subscriptions')
      .select('email')
      .eq('stripe_customer_id', stripeCustomerId)
      .maybeSingle()
    email = existing?.email ?? null
  }

  if (!email) {
    // First time we've seen this subscription — read the email off the Stripe
    // customer record.
    const secret = process.env.STRIPE_SECRET_KEY
    if (!secret) throw new PermanentJobError('STRIPE_SECRET_KEY is not set')
    const { default: StripeCtor } = await import('stripe')
    const stripe = new StripeCtor(secret, { apiVersion: '2026-05-27.dahlia' })
    if (!stripeCustomerId) throw new PermanentJobError('Subscription has no customer')
    const customer = await stripe.customers.retrieve(stripeCustomerId)
    if (customer.deleted) throw new PermanentJobError('Stripe customer was deleted')
    email = customer.email
  }

  if (!email) {
    throw new PermanentJobError('Could not determine the email for this subscription')
  }

  // 'deleted' means the subscription is gone; record it as canceled so the
  // entitlement lookup stops counting it.
  const status = eventType === 'customer.subscription.deleted' ? 'canceled' : subscription.status
  const { plan, billingPeriod } = resolvePlan(subscription)
  const periodEndSeconds = (subscription as unknown as { current_period_end?: number })
    .current_period_end

  const { data: saved, error } = await supabase
    .from('subscriptions')
    .upsert(
      {
        email: email.toLowerCase(),
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: subscription.id,
        plan,
        billing_period: billingPeriod,
        status,
        current_period_end: periodEndSeconds
          ? new Date(periodEndSeconds * 1000).toISOString()
          : null,
        cancel_at_period_end: subscription.cancel_at_period_end ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'stripe_subscription_id' }
    )
    .select('id, customer_id')
    .single()

  if (error) throw new Error(`Could not save subscription: ${error.message}`)

  // Link it to a customer if one already exists for this email. Usually they
  // sign up after paying, in which case the login path claims it instead.
  let customerId = saved.customer_id as string | null
  if (!customerId) {
    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .ilike('email', email)
      .maybeSingle()
    if (customer) {
      customerId = customer.id
      await supabase.from('subscriptions').update({ customer_id: customerId }).eq('id', saved.id)
    }
  }

  if (customerId) {
    // A lapsed subscription drops the account to free limits.
    await syncAiBudgetToPlan(customerId, isPaidStatus(status) ? plan : 'free')
  }

  console.log(
    `[stripe.event] ${email} → ${plan} (${status})${customerId ? '' : ' — not yet linked to an account'}`
  )
}

// ── maintenance.purge ────────────────────────────────────────────────────────

async function handleMaintenancePurge(): Promise<void> {
  const supabase = getSupabaseAdmin()
  const [jobs, limits] = await Promise.all([
    supabase.rpc('purge_finished_jobs', { p_retain_days: 30 }),
    supabase.rpc('purge_expired_rate_limits'),
  ])
  console.log(
    `[maintenance.purge] removed ${jobs.data ?? 0} finished job(s), ${limits.data ?? 0} rate-limit row(s)`
  )
}
