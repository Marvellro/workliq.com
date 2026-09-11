import { getSupabaseAdmin } from './config'
import { decrypt } from './crypto'
import { hubspotDealLink } from './hubspot-deals'
import { PermanentJobError } from './jobs'
import {
  sendSlackMessage,
  createNotionPage,
  callWebhook,
  getOrCreateWebhookSecret,
} from './workflow-actions'
import { BlockedAddressError } from './safe-fetch'
import type { WorkflowRow, TriggerEvent } from './workflow-engine'

// Executes exactly one workflow action, for one deal, for one event.
//
// Split out of workflow-engine.ts so that detection ("which workflows should
// fire?") and delivery ("actually post to Slack") are separate concerns running
// in separate processes. Detection happens in the request that noticed the
// event; delivery happens in a job that can be retried.
//
// Everything needed is carried in the job payload rather than re-fetched. Two
// reasons: the action then reflects the deal as it was when the event
// happened, not as it is at retry time; and delivery keeps working while
// HubSpot's API is unavailable, which is exactly when retries pile up.

export type ActionPayload = {
  workflowId: string
  customerId: string
  hubId: string
  dealId: string
  dealName: string | null
  dealStage: string | null
  ownerName: string
  event: TriggerEvent
}

/** Type guard for a job payload arriving from the queue as untyped JSON. */
export function isActionPayload(value: unknown): value is ActionPayload {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return (
    typeof p.workflowId === 'string' &&
    typeof p.customerId === 'string' &&
    typeof p.hubId === 'string' &&
    typeof p.dealId === 'string' &&
    typeof p.ownerName === 'string' &&
    typeof p.event === 'object' &&
    p.event !== null
  )
}

function fillTemplate(
  template: string,
  payload: ActionPayload
): string {
  return template
    .replaceAll('{{deal_name}}', payload.dealName ?? 'Unnamed deal')
    .replaceAll('{{stage}}', payload.dealStage ?? 'Unknown stage')
    .replaceAll('{{owner}}', payload.ownerName)
    .replaceAll('{{link}}', hubspotDealLink(payload.hubId, payload.dealId))
}

function defaultSlackText(payload: ActionPayload): string {
  const { event } = payload
  const dealName = payload.dealName ?? 'Unnamed deal'
  const link = hubspotDealLink(payload.hubId, payload.dealId)

  const headline =
    event.type === 'deal_created'
      ? `🆕 *New deal* — ${dealName}`
      : event.type === 'deal_stage_changed'
      ? `➡️ *Deal moved to ${event.newStage}* — ${dealName}`
      : `⚠️ *Stale deal* (${event.daysStale}d, threshold ${event.thresholdDays}d) — ${dealName}`

  return [headline, `Owner: ${payload.ownerName}`, `<${link}|View in HubSpot>`].join('\n')
}

/**
 * Runs one action and records the outcome in `workflow_runs`.
 *
 * Idempotency: `workflow_runs` carries a unique key on
 * (workflow, deal, event fingerprint). If that row is already `success` the
 * action has happened and this returns without repeating it — which is what
 * makes the job safe to retry, and safe to reach from both the webhook path
 * and the reconciliation poll.
 */
export async function executeWorkflowAction(payload: ActionPayload): Promise<void> {
  const supabase = getSupabaseAdmin()

  const { data: workflow, error: workflowError } = await supabase
    .from('workflows')
    .select('*')
    .eq('id', payload.workflowId)
    .eq('customer_id', payload.customerId)
    .maybeSingle()

  if (workflowError) {
    throw new Error(`Could not load workflow: ${workflowError.message}`)
  }
  if (!workflow) {
    // Deleted between enqueue and execution. Retrying cannot bring it back.
    throw new PermanentJobError(`Workflow ${payload.workflowId} no longer exists`)
  }
  if (!workflow.enabled) {
    // Disabled after the job was queued — honour the customer's intent rather
    // than firing an action they just switched off.
    throw new PermanentJobError(`Workflow ${payload.workflowId} is disabled`)
  }

  // Claim-first, matching the pattern already used by deal_alerts: the upsert
  // carries only the conflict-key columns, so on conflict Postgres leaves the
  // existing status untouched and hands it back to us.
  const { data: claimed, error: claimError } = await supabase
    .from('workflow_runs')
    .upsert(
      {
        workflow_id: payload.workflowId,
        customer_id: payload.customerId,
        deal_id: payload.dealId,
        trigger_fingerprint: payload.event.fingerprint,
      },
      { onConflict: 'workflow_id,deal_id,trigger_fingerprint', ignoreDuplicates: false }
    )
    .select('id, status')
    .single()

  if (claimError || !claimed) {
    throw new Error(`Could not claim workflow run: ${claimError?.message ?? 'no row'}`)
  }

  if (claimed.status === 'success') return // already delivered

  try {
    await runAction(workflow as WorkflowRow, payload, supabase)

    await supabase
      .from('workflow_runs')
      .update({ status: 'success', error_message: null, fired_at: new Date().toISOString() })
      .eq('id', claimed.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    await supabase
      .from('workflow_runs')
      .update({ status: 'failed', error_message: message, fired_at: new Date().toISOString() })
      .eq('id', claimed.id)

    // A blocked address is a configuration problem, not a transient one — the
    // customer's URL points somewhere it is never allowed to reach, and that
    // will be equally true in an hour.
    if (err instanceof BlockedAddressError) {
      throw new PermanentJobError(message)
    }
    throw err
  }
}

async function runAction(
  workflow: WorkflowRow,
  payload: ActionPayload,
  supabase: ReturnType<typeof getSupabaseAdmin>
): Promise<void> {
  switch (workflow.action_type) {
    case 'slack_message': {
      const { data: conn } = await supabase
        .from('slack_connections')
        .select('webhook_url')
        .eq('customer_id', payload.customerId)
        .maybeSingle()

      if (!conn) throw new PermanentJobError('No Slack connection for this customer')

      const text = workflow.action_config.message_template
        ? fillTemplate(workflow.action_config.message_template, payload)
        : defaultSlackText(payload)

      await sendSlackMessage(decrypt(conn.webhook_url), text)
      return
    }

    case 'notion_row': {
      const { data: conn } = await supabase
        .from('notion_connections')
        .select('access_token, database_id')
        .eq('customer_id', payload.customerId)
        .maybeSingle()

      if (!conn) throw new PermanentJobError('No Notion connection for this customer')

      const properties: Record<string, unknown> = {
        'Deal Name': { title: [{ text: { content: payload.dealName ?? 'Unnamed deal' } }] },
        Stage: { select: { name: payload.dealStage ?? 'Unknown' } },
        Owner: { rich_text: [{ text: { content: payload.ownerName } }] },
        'Flagged On': { date: { start: new Date().toISOString().split('T')[0] } },
        'HubSpot Link': { url: hubspotDealLink(payload.hubId, payload.dealId) },
        Status: { select: { name: 'New' } },
      }
      // Days Stale / Threshold only apply to the staleness trigger.
      if (payload.event.type === 'deal_stale') {
        properties['Days Stale'] = { number: payload.event.daysStale }
        properties['Threshold'] = { select: { name: String(payload.event.thresholdDays) } }
      }

      await createNotionPage(
        { access_token: decrypt(conn.access_token), database_id: conn.database_id },
        properties
      )
      return
    }

    case 'webhook': {
      const url = workflow.action_config.url
      if (!url) throw new PermanentJobError('Webhook workflow has no URL configured')

      const secret = await getOrCreateWebhookSecret(payload.customerId)

      await callWebhook(
        url,
        {
          workflow_id: workflow.id,
          workflow_name: workflow.name,
          trigger: payload.event.type,
          deal_id: payload.dealId,
          deal_name: payload.dealName,
          stage: payload.dealStage,
          owner: payload.ownerName,
          hubspot_link: hubspotDealLink(payload.hubId, payload.dealId),
        },
        secret
      )
      return
    }
  }
}
