import { getSupabaseAdmin } from './config'
import { decrypt } from './crypto'
import { hubspotDealLink } from './hubspot-deals'
import { PermanentJobError } from './jobs'
import {
  stepsFor,
  fillTemplate,
  ACTION_LABELS,
  type WorkflowStep,
  type TemplateFacts,
} from './workflow-steps'
import {
  sendSlackMessage,
  createNotionPage,
  callWebhook,
  getOrCreateWebhookSecret,
} from './workflow-actions'
import { BlockedAddressError } from './safe-fetch'
import {
  runAIStep,
  renderResult,
  AIBudgetError,
  AIConfigError,
  AI_TASK_LABELS,
  type AITask,
  type DealFacts,
} from './ai'
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

function describeTrigger(payload: ActionPayload): string {
  const { event } = payload
  switch (event.type) {
    case 'deal_created':
      return 'This deal was just created.'
    case 'deal_stage_changed':
      return `This deal just moved into the "${event.newStage}" stage.`
    case 'deal_stale':
      return `This deal has had no recorded activity for ${event.daysStale} days, past the ${event.thresholdDays}-day threshold the team set.`
  }
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
 * Runs a workflow's steps in order, recording each one in `workflow_runs`.
 *
 * Idempotency is per step. `workflow_runs` is unique on
 * (workflow, deal, event fingerprint, step index), so each step claims its own
 * row and a retry resumes after the last one that succeeded. Before 016 the key
 * had no step index, and a two-step workflow whose second step failed would
 * re-send the first on every attempt — five retries, five duplicate messages.
 *
 * Steps run sequentially and a failure stops the run. The alternative, carrying
 * on past a failed step, would mean a workflow reporting success while part of
 * what the customer asked for silently did not happen — and the whole reason
 * this ledger exists is to stop that being possible.
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

  const row = workflow as WorkflowRow
  const steps = stepsFor(row)

  if (steps.length === 0) {
    throw new PermanentJobError(`Workflow ${payload.workflowId} has no steps configured`)
  }

  const facts: TemplateFacts = {
    dealName: payload.dealName ?? 'Unnamed deal',
    stage: payload.dealStage ?? 'Unknown stage',
    owner: payload.ownerName,
    link: hubspotDealLink(payload.hubId, payload.dealId),
  }

  // Outputs of steps that have run, indexed by position. Populated from the
  // ledger for steps skipped on a retry — see the claim below.
  const outputs: (string | null)[] = []

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]

    // Claim-first, carrying only the conflict-key columns so that on conflict
    // Postgres leaves the existing status untouched and hands it back.
    const { data: claimed, error: claimError } = await supabase
      .from('workflow_runs')
      .upsert(
        {
          workflow_id: payload.workflowId,
          customer_id: payload.customerId,
          deal_id: payload.dealId,
          trigger_fingerprint: payload.event.fingerprint,
          step_index: index,
        },
        {
          onConflict: 'workflow_id,deal_id,trigger_fingerprint,step_index',
          ignoreDuplicates: false,
        }
      )
      .select('id, status, output')
      .single()

    if (claimError || !claimed) {
      throw new Error(`Could not claim step ${index + 1}: ${claimError?.message ?? 'no row'}`)
    }

    if (claimed.status === 'success') {
      // Already delivered on an earlier attempt. Recover whatever it produced
      // so a later step referencing {{stepN}} still has it — the step itself is
      // not going to run again to regenerate it.
      outputs[index] = claimed.output ?? null
      continue
    }

    try {
      const output = await runStep(step, { workflow: row, payload, supabase, facts, outputs })
      outputs[index] = output

      await supabase
        .from('workflow_runs')
        .update({
          status: 'success',
          error_message: null,
          output,
          fired_at: new Date().toISOString(),
        })
        .eq('id', claimed.id)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)

      // Name the step in what the customer reads. "Step 2 (Send a Slack
      // message) failed" is actionable; the bare provider error is not, once a
      // workflow can have more than one thing in it.
      await supabase
        .from('workflow_runs')
        .update({
          status: 'failed',
          error_message: `Step ${index + 1} (${ACTION_LABELS[step.action_type]}): ${message}`,
          fired_at: new Date().toISOString(),
        })
        .eq('id', claimed.id)

      // Rethrow the original error, never a wrapped one. The queue classifies
      // on type — PermanentJobError, ConnectionError — and a wrapper would
      // erase that, turning a dead credential back into something retried five
      // times.
      if (err instanceof BlockedAddressError) {
        throw new PermanentJobError(message)
      }
      throw err
    }
  }
}

type StepContext = {
  workflow: WorkflowRow
  payload: ActionPayload
  supabase: ReturnType<typeof getSupabaseAdmin>
  facts: TemplateFacts
  outputs: (string | null)[]
}

/**
 * Runs one step.
 *
 * Returns what the step produced, or null when it produces nothing worth
 * carrying forward. Only the AI step currently produces anything; the delivery
 * actions return null rather than, say, a Slack timestamp, because nothing
 * downstream has a use for it and storing it would be collecting data for its
 * own sake.
 */
async function runStep(step: WorkflowStep, ctx: StepContext): Promise<string | null> {
  const { payload, supabase, facts, outputs } = ctx
  const config = step.action_config ?? {}

  switch (step.action_type) {
    case 'slack_message': {
      const { data: conn } = await supabase
        .from('slack_connections')
        .select('webhook_url')
        .eq('customer_id', payload.customerId)
        .maybeSingle()

      if (!conn) throw new PermanentJobError('No Slack connection for this customer')

      const text = config.message_template
        ? fillTemplate(config.message_template, facts, outputs)
        : defaultSlackText(payload)

      await sendSlackMessage(payload.customerId, decrypt(conn.webhook_url), text)
      return null
    }

    case 'notion_row': {
      const { data: conn } = await supabase
        .from('notion_connections')
        .select('access_token, database_id')
        .eq('customer_id', payload.customerId)
        .maybeSingle()

      if (!conn) throw new PermanentJobError('No Notion connection for this customer')

      const properties: Record<string, unknown> = {
        'Deal Name': { title: [{ text: { content: facts.dealName } }] },
        Stage: { select: { name: payload.dealStage ?? 'Unknown' } },
        Owner: { rich_text: [{ text: { content: payload.ownerName } }] },
        'Flagged On': { date: { start: new Date().toISOString().split('T')[0] } },
        'HubSpot Link': { url: facts.link },
        Status: { select: { name: 'New' } },
      }

      // Days Stale / Threshold only apply to the staleness trigger.
      if (payload.event.type === 'deal_stale') {
        properties['Days Stale'] = { number: payload.event.daysStale }
        properties['Threshold'] = { select: { name: String(payload.event.thresholdDays) } }
      }

      // A template here fills the Notes column, which is how an earlier AI
      // step's text reaches Notion as its own step.
      if (config.message_template) {
        properties['Notes'] = {
          // Notion caps a rich_text value at 2000 characters.
          rich_text: [
            { text: { content: fillTemplate(config.message_template, facts, outputs).slice(0, 2000) } },
          ],
        }
      }

      await createNotionPage(
        payload.customerId,
        { access_token: decrypt(conn.access_token), database_id: conn.database_id },
        properties
      )
      return null
    }

    case 'ai_step':
      return runAIStepAction(step, ctx)

    case 'webhook': {
      const url = config.url
      if (!url) throw new PermanentJobError('Webhook step has no URL configured')

      const secret = await getOrCreateWebhookSecret(payload.customerId)

      await callWebhook(
        url,
        {
          workflow_id: ctx.workflow.id,
          workflow_name: ctx.workflow.name,
          trigger: payload.event.type,
          deal_id: payload.dealId,
          deal_name: payload.dealName,
          stage: payload.dealStage,
          owner: payload.ownerName,
          hubspot_link: facts.link,
          // Whatever earlier steps produced, so a webhook can be the thing that
          // receives an AI draft rather than only the raw deal.
          steps: outputs,
        },
        secret
      )
      return null
    }
  }
}

/**
 * The AI step.
 *
 * Returns the generated text so later steps can use it via `{{stepN}}`.
 *
 * `deliver_to` is the legacy shape: before steps existed, an AI step had to
 * deliver its own output, so it carried a channel. It is honoured only when
 * explicitly present, which every workflow written before 016 does — those keep
 * behaving exactly as they did. A new workflow leaves it unset and expresses
 * delivery as its own step, which is the entire point of this change.
 */
async function runAIStepAction(step: WorkflowStep, ctx: StepContext): Promise<string> {
  const { workflow, payload, supabase, facts } = ctx
  const config = step.action_config ?? {}

  const task = config.ai_task as AITask | undefined
  if (!task) throw new PermanentJobError('AI step has no task configured')

  // Only these fields ever leave our infrastructure. Constructed explicitly
  // rather than spreading the deal object, so widening the HubSpot fetch can
  // never silently start sending more to a third party.
  const dealFacts: DealFacts = {
    dealName: facts.dealName,
    stage: payload.dealStage ?? 'Unknown',
    owner: payload.ownerName,
    triggerDescription: describeTrigger(payload),
    ...(payload.event.type === 'deal_stale'
      ? { daysSinceLastActivity: payload.event.daysStale }
      : {}),
  }

  let text: string
  try {
    const result = await runAIStep({
      customerId: payload.customerId,
      workflowId: workflow.id,
      task,
      facts: dealFacts,
      instructions: config.ai_instructions,
    })
    text = renderResult(result)
  } catch (err) {
    // Budget and configuration failures are permanent: retrying an exhausted
    // budget four more times just burns attempts, and each retry would re-run
    // the token count.
    if (err instanceof AIBudgetError || err instanceof AIConfigError) {
      throw new PermanentJobError(err.message)
    }
    throw err
  }

  if (!config.deliver_to) return text

  const header = `🤖 *${AI_TASK_LABELS[task]}* — ${facts.dealName}`

  if (config.deliver_to === 'notion_row') {
    const { data: notionConn } = await supabase
      .from('notion_connections')
      .select('access_token, database_id')
      .eq('customer_id', payload.customerId)
      .maybeSingle()
    if (!notionConn) throw new PermanentJobError('No Notion connection for this customer')

    await createNotionPage(
      payload.customerId,
      { access_token: decrypt(notionConn.access_token), database_id: notionConn.database_id },
      {
        'Deal Name': { title: [{ text: { content: facts.dealName } }] },
        Stage: { select: { name: payload.dealStage ?? 'Unknown' } },
        Owner: { rich_text: [{ text: { content: payload.ownerName } }] },
        // Notion caps a rich_text value at 2000 characters.
        Notes: { rich_text: [{ text: { content: text.slice(0, 2000) } }] },
        'Flagged On': { date: { start: new Date().toISOString().split('T')[0] } },
        'HubSpot Link': { url: facts.link },
        Status: { select: { name: 'New' } },
      }
    )
    return text
  }

  const { data: slackConn } = await supabase
    .from('slack_connections')
    .select('webhook_url')
    .eq('customer_id', payload.customerId)
    .maybeSingle()
  if (!slackConn) throw new PermanentJobError('No Slack connection for this customer')

  await sendSlackMessage(
    payload.customerId,
    decrypt(slackConn.webhook_url),
    [header, '', text, '', `<${facts.link}|View in HubSpot>`].join('\n')
  )

  // Returned regardless of delivery, so a later step can still reference it.
  return text
}
