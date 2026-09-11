import type { SupabaseClient } from '@supabase/supabase-js'
import type { HubSpotDeal } from './hubspot-deals'
import { enqueue } from './jobs'
import type { ActionPayload } from './workflow-execute'

const MS_PER_DAY = 1000 * 60 * 60 * 24

export type TriggerType = 'deal_stage_changed' | 'deal_created' | 'deal_stale'
export type ActionType = 'slack_message' | 'notion_row' | 'webhook'
export type ConditionOperator = 'equals' | 'not_equals' | 'contains'

export type WorkflowRow = {
  id: string
  name: string
  trigger_type: TriggerType
  trigger_config: { to_stage?: string; threshold_days?: number }
  condition_property: string | null
  condition_operator: ConditionOperator | null
  condition_value: string | null
  action_type: ActionType
  action_config: { message_template?: string; url?: string }
  enabled: boolean
}

export type TriggerEvent =
  | { type: 'deal_created'; fingerprint: string }
  | { type: 'deal_stage_changed'; fingerprint: string; newStage: string }
  | { type: 'deal_stale'; fingerprint: string; thresholdDays: number; daysStale: number }

type RunParams = {
  supabase: SupabaseClient
  customerId: string
  hubId: string
  deals: HubSpotDeal[]
  ownerMap: Map<string, string>
  workflows: WorkflowRow[]
}

// ── Condition evaluation ─────────────────────────────────────────────────────

export function getDealPropertyValue(
  deal: HubSpotDeal,
  property: string,
  ownerMap: Map<string, string>
): string | null {
  switch (property) {
    case 'dealstage':
      return deal.properties.dealstage
    case 'dealname':
      return deal.properties.dealname
    case 'hubspot_owner_id': {
      const id = deal.properties.hubspot_owner_id
      return id ? ownerMap.get(id) ?? id : null
    }
    default:
      return null
  }
}

function evaluateCondition(
  actual: string | null,
  operator: ConditionOperator,
  expected: string
): boolean {
  const a = (actual ?? '').toLowerCase()
  const e = expected.toLowerCase()
  switch (operator) {
    case 'equals':
      return a === e
    case 'not_equals':
      return a !== e
    case 'contains':
      return a.includes(e)
  }
}

export function workflowMatchesCondition(
  workflow: WorkflowRow,
  deal: HubSpotDeal,
  ownerMap: Map<string, string>
): boolean {
  if (!workflow.condition_property || !workflow.condition_operator || workflow.condition_value === null) {
    return true // no condition configured — trigger match alone is enough
  }
  const actual = getDealPropertyValue(deal, workflow.condition_property, ownerMap)
  return evaluateCondition(actual, workflow.condition_operator, workflow.condition_value)
}

// ── Message building ─────────────────────────────────────────────────────────

// ── Main entry point ─────────────────────────────────────────────────────────

// Evaluates every deal for one customer against their configured workflows and
// queues a job for each match, keeping deal_snapshots current so the next run
// can detect future changes.
//
// This is now the reconciliation path. Real-time events arrive via
// app/api/webhooks/hubspot, and this sweep catches anything a webhook dropped
// (delivery failure, downtime, a subscription added after the fact) plus the
// staleness triggers, which are time-based and have no webhook to fire them.
// Both paths share an idempotency key, so an event seen twice delivers once.
export async function runWorkflowsForCustomer(params: RunParams): Promise<{ queued: number; failed: number }> {
  const { supabase, customerId, hubId, deals, ownerMap, workflows } = params

  const enabledWorkflows = workflows.filter((w) => w.enabled)
  if (enabledWorkflows.length === 0 || deals.length === 0) {
    return { queued: 0, failed: 0 }
  }

  // Distinct staleness thresholds actually configured, so we don't compute
  // "days stale" work for thresholds nobody uses.
  const staleThresholds = new Set(
    enabledWorkflows
      .filter((w) => w.trigger_type === 'deal_stale')
      .map((w) => w.trigger_config.threshold_days)
      .filter((n): n is number => typeof n === 'number')
  )

  const { data: snapshots } = await supabase
    .from('deal_snapshots')
    .select('deal_id, last_stage')
    .eq('customer_id', customerId)

  const snapshotMap = new Map<string, string | null>()
  for (const s of snapshots ?? []) snapshotMap.set(s.deal_id, s.last_stage)

  // If this customer has never had a deal_snapshots row before, every deal in
  // their portal looks "new" purely because we've never seen it — not because
  // it was actually just created. Without this guard, a customer's first-ever
  // engine run after enabling a deal_created workflow would fire that workflow
  // for their entire historical deal backlog (e.g. 500 pre-existing deals →
  // 500 Slack messages in one run). Snapshots are still seeded below so
  // subsequent runs detect real creates/changes normally.
  const isFirstRunForCustomer = snapshotMap.size === 0

  let queued = 0
  let failed = 0

  for (const deal of deals) {
    const hadSnapshot = snapshotMap.has(deal.id)
    const priorStage = snapshotMap.get(deal.id)
    const currentStage = deal.properties.dealstage

    const events: TriggerEvent[] = []

    if (!hadSnapshot) {
      if (!isFirstRunForCustomer) {
        events.push({ type: 'deal_created', fingerprint: deal.id })
      }
    } else if (currentStage && currentStage !== priorStage) {
      events.push({
        type: 'deal_stage_changed',
        fingerprint: `${deal.id}:${currentStage}`,
        newStage: currentStage,
      })
    }

    if (staleThresholds.size > 0 && deal.properties.notes_last_updated) {
      const lastActivityMs = new Date(deal.properties.notes_last_updated).getTime()
      if (!isNaN(lastActivityMs)) {
        const daysStale = Math.floor((Date.now() - lastActivityMs) / MS_PER_DAY)
        for (const thresholdDays of staleThresholds) {
          if (daysStale >= thresholdDays) {
            events.push({
              type: 'deal_stale',
              fingerprint: `${deal.id}:${thresholdDays}`,
              thresholdDays,
              daysStale,
            })
          }
        }
      }
    }

    // Keep the snapshot current regardless of whether any workflow fired, so
    // the next run's diff is accurate.
    await supabase
      .from('deal_snapshots')
      .upsert(
        { customer_id: customerId, deal_id: deal.id, last_stage: currentStage, updated_at: new Date().toISOString() },
        { onConflict: 'customer_id,deal_id' }
      )

    for (const event of events) {
      const matchingWorkflows = enabledWorkflows.filter((w) => {
        if (w.trigger_type !== event.type) return false
        if (event.type === 'deal_stage_changed' && w.trigger_config.to_stage) {
          return w.trigger_config.to_stage === event.newStage
        }
        if (event.type === 'deal_stale') {
          return w.trigger_config.threshold_days === event.thresholdDays
        }
        return true
      })

      for (const workflow of matchingWorkflows) {
        if (!workflowMatchesCondition(workflow, deal, ownerMap)) continue

        const ownerName = deal.properties.hubspot_owner_id
          ? ownerMap.get(deal.properties.hubspot_owner_id) ?? deal.properties.hubspot_owner_id
          : 'Unassigned'

        // Enqueue rather than execute.
        //
        // Previously the action ran inline here and got exactly one attempt —
        // a Slack blip or a customer endpoint returning 502 meant the alert
        // was recorded failed and never retried. Now delivery is a durable job
        // with backoff and a dead-letter path.
        //
        // The idempotency key is the same triple that workflow_runs is unique
        // on, so this path and the webhook path converge on one delivery even
        // when both observe the same event.
        const payload: ActionPayload = {
          workflowId: workflow.id,
          customerId,
          hubId,
          dealId: deal.id,
          dealName: deal.properties.dealname,
          dealStage: deal.properties.dealstage,
          ownerName,
          event,
        }

        try {
          const jobId = await enqueue({
            kind: 'workflow.action',
            customerId,
            payload: payload as unknown as Record<string, unknown>,
            idempotencyKey: `workflow.action:${workflow.id}:${deal.id}:${event.fingerprint}`,
          })
          // null means an identical job is already queued or running — the work
          // is scheduled either way, so this is a success, not a failure.
          if (jobId) queued++
        } catch (err) {
          console.error(
            `[workflow-engine] workflow ${workflow.id} deal ${deal.id} event ${event.type}: enqueue failed —`,
            err
          )
          failed++
        }
      }
    }
  }

  return { queued, failed }
}
