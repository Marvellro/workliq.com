import type { SupabaseClient } from '@supabase/supabase-js'
import type { HubSpotDeal } from './hubspot-deals'
import { hubspotDealLink } from './hubspot-deals'
import {
  sendSlackMessage,
  createNotionPage,
  callWebhook,
  type SlackConnection,
  type NotionConnection,
} from './workflow-actions'

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

type TriggerEvent =
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
  slackConn: SlackConnection | null
  notionConn: NotionConnection | null
}

// ── Condition evaluation ─────────────────────────────────────────────────────

function getDealPropertyValue(
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

function workflowMatchesCondition(
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

function fillTemplate(template: string, deal: HubSpotDeal, hubId: string, ownerName: string): string {
  return template
    .replaceAll('{{deal_name}}', deal.properties.dealname ?? 'Unnamed deal')
    .replaceAll('{{stage}}', deal.properties.dealstage ?? 'Unknown stage')
    .replaceAll('{{owner}}', ownerName)
    .replaceAll('{{link}}', hubspotDealLink(hubId, deal.id))

}

function defaultSlackText(
  workflow: WorkflowRow,
  event: TriggerEvent,
  deal: HubSpotDeal,
  hubId: string,
  ownerName: string
): string {
  const dealName = deal.properties.dealname ?? 'Unnamed deal'
  const link = hubspotDealLink(hubId, deal.id)

  const headline =
    event.type === 'deal_created'
      ? `🆕 *New deal* — ${dealName}`
      : event.type === 'deal_stage_changed'
      ? `➡️ *Deal moved to ${event.newStage}* — ${dealName}`
      : `⚠️ *Stale deal* (${event.daysStale}d, threshold ${event.thresholdDays}d) — ${dealName}`

  return [headline, `Owner: ${ownerName}`, `<${link}|View in HubSpot>`].join('\n')
}

// ── Main entry point ─────────────────────────────────────────────────────────

// Evaluates every deal for one customer against their configured workflows,
// fires matching actions (deduped via workflow_runs), and keeps deal_snapshots
// current so the next cron run can detect future changes. Returns counts for
// logging; individual failures are swallowed per-deal-per-workflow so one bad
// webhook doesn't stop the rest of the customer's workflows from running.
export async function runWorkflowsForCustomer(params: RunParams): Promise<{ fired: number; failed: number }> {
  const { supabase, customerId, hubId, deals, ownerMap, workflows, slackConn, notionConn } = params

  const enabledWorkflows = workflows.filter((w) => w.enabled)
  if (enabledWorkflows.length === 0 || deals.length === 0) {
    return { fired: 0, failed: 0 }
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

  let fired = 0
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

        // Claim this (workflow, deal, event) atomically before executing the
        // action, mirroring deal_alerts' claim-first pattern: the upsert
        // payload carries only the conflict-key columns, so on conflict
        // Postgres leaves the existing `status` untouched (it's not in the
        // SET list) rather than resetting it to the default. That means this
        // one call both creates-if-absent AND reads the current status,
        // closing the select-then-act race the previous version had (two
        // overlapping cron invocations could both pass a separate `select`,
        // both fire the action, and both write 'success'). This narrows but
        // doesn't fully eliminate the race — two upserts landing in the same
        // instant could still both read back 'pending' — full mutual
        // exclusion would need a DB-level compare-and-swap. That residual
        // risk matches deal_alerts' existing posture and is acceptable for a
        // once-daily cron with no expected overlapping invocations.
        const { data: claimed, error: claimErr } = await supabase
          .from('workflow_runs')
          .upsert(
            {
              workflow_id: workflow.id,
              customer_id: customerId,
              deal_id: deal.id,
              trigger_fingerprint: event.fingerprint,
            },
            { onConflict: 'workflow_id,deal_id,trigger_fingerprint', ignoreDuplicates: false }
          )
          .select('id, status')
          .single()

        if (claimErr || !claimed) {
          console.error(
            `[workflow-engine] workflow ${workflow.id} deal ${deal.id} event ${event.type}: claim upsert failed —`,
            claimErr
          )
          continue
        }

        if (claimed.status === 'success') continue

        try {
          await executeAction(workflow, event, deal, hubId, ownerName, slackConn, notionConn)

          await supabase
            .from('workflow_runs')
            .update({ status: 'success', error_message: null, fired_at: new Date().toISOString() })
            .eq('id', claimed.id)
          fired++
        } catch (err) {
          console.error(
            `[workflow-engine] workflow ${workflow.id} deal ${deal.id} event ${event.type}: action failed —`,
            err
          )
          await supabase
            .from('workflow_runs')
            .update({
              status: 'failed',
              error_message: err instanceof Error ? err.message : String(err),
              fired_at: new Date().toISOString(),
            })
            .eq('id', claimed.id)
          failed++
        }
      }
    }
  }

  return { fired, failed }
}

async function executeAction(
  workflow: WorkflowRow,
  event: TriggerEvent,
  deal: HubSpotDeal,
  hubId: string,
  ownerName: string,
  slackConn: SlackConnection | null,
  notionConn: NotionConnection | null
): Promise<void> {
  switch (workflow.action_type) {
    case 'slack_message': {
      if (!slackConn) throw new Error('No Slack connection for this customer')
      const text = workflow.action_config.message_template
        ? fillTemplate(workflow.action_config.message_template, deal, hubId, ownerName)
        : defaultSlackText(workflow, event, deal, hubId, ownerName)
      await sendSlackMessage(slackConn.webhook_url, text)
      return
    }
    case 'notion_row': {
      if (!notionConn) throw new Error('No Notion connection for this customer')
      const dealName = deal.properties.dealname ?? 'Unnamed deal'
      const stage = deal.properties.dealstage ?? 'Unknown'
      const link = hubspotDealLink(hubId, deal.id)
      const today = new Date().toISOString().split('T')[0]

      const properties: Record<string, unknown> = {
        'Deal Name': { title: [{ text: { content: dealName } }] },
        Stage: { select: { name: stage } },
        Owner: { rich_text: [{ text: { content: ownerName } }] },
        'Flagged On': { date: { start: today } },
        'HubSpot Link': { url: link },
        Status: { select: { name: 'New' } },
      }
      // Days Stale / Threshold only apply to the staleness trigger — the
      // database's other columns are simply left blank for other events.
      if (event.type === 'deal_stale') {
        properties['Days Stale'] = { number: event.daysStale }
        properties['Threshold'] = { select: { name: String(event.thresholdDays) } }
      }

      await createNotionPage(notionConn, properties)
      return
    }
    case 'webhook': {
      const url = workflow.action_config.url
      if (!url) throw new Error('Webhook workflow has no URL configured')
      await callWebhook(url, {
        workflow_id: workflow.id,
        workflow_name: workflow.name,
        trigger: event.type,
        deal_id: deal.id,
        deal_name: deal.properties.dealname,
        stage: deal.properties.dealstage,
        owner: ownerName,
        hubspot_link: hubspotDealLink(hubId, deal.id),
      })
      return
    }
  }
}
