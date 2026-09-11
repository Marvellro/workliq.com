import { getSupabaseAdmin } from './config'
import { registerHandler, enqueue, PermanentJobError, type JobRecord } from './jobs'
import { executeWorkflowAction, isActionPayload, type ActionPayload } from './workflow-execute'
import { workflowMatchesCondition, type WorkflowRow, type TriggerEvent } from './workflow-engine'
import { getValidHubSpotToken } from './hubspot'
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
