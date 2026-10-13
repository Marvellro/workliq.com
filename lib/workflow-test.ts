import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from './config'
import { getValidHubSpotToken } from './hubspot'
import { fetchDeal, fetchOwnerMap, type HubSpotDeal } from './hubspot-deals'
import { ConnectionError, markConnectionUnhealthy } from './connection-health'
import { executeWorkflowAction, type ActionPayload } from './workflow-execute'
import {
  workflowMatchesCondition,
  getDealPropertyValue,
  type WorkflowRow,
  type TriggerEvent,
} from './workflow-engine'
import { stepsFor, ACTION_LABELS, type WorkflowStep } from './workflow-steps'
import { TEST_FINGERPRINT_PREFIX } from './test-fingerprint'

// "Send a test": run a workflow now, against a real deal the customer picks.
//
// Without this, the only way to find out whether a workflow works was to wait
// for a deal to change in HubSpot — and a workflow set up wrong (a Slack
// channel that was removed, a webhook that 404s, an AI instruction that
// produces nonsense) was discovered at the worst possible moment, or never.
//
// ── What a test is ──────────────────────────────────────────────────────────
// The workflow's trigger, simulated as happening to a real deal. Everything
// the deal can supply is the deal's own — name, owner, stage, activity. What it
// cannot supply comes from the workflow's settings: a stage-change workflow
// that fires on "closedwon", tested against a deal that is still in
// "appointmentscheduled", is shown what it would send when that deal *moves*
// into closedwon. Every fact simulated that way is listed back to the
// customer, so a simulation is never mistaken for their real data.
//
// It runs through the same execution path as a real event — the same claims,
// the same deliveries — so it tests what actually runs rather than a copy of
// it that could drift. The differences are confined to test mode in
// workflow-execute.ts: every delivery marked, and a disabled workflow allowed.
//
// It runs inline rather than through the queue. A test should fail fast and
// show the error; retrying it quietly in the background for an hour would be
// exactly the wrong behaviour for something a person is watching.

const MS_PER_DAY = 1000 * 60 * 60 * 24

/** AI output shown on screen is capped; the full text is what was delivered. */
export const OUTPUT_PREVIEW_CHARS = 4000

export type Simulation = {
  event: TriggerEvent
  /** The stage the run reports — the deal's own, unless the trigger moved it. */
  dealStage: string | null
  /** Facts taken from the workflow's settings rather than from the deal. */
  simulated: string[]
  /** Set when the deal would not pass the workflow's condition for real. */
  conditionNote: string | null
}

const CONDITION_PROPERTY_LABELS: Record<string, string> = {
  dealstage: 'stage',
  dealname: 'deal name',
  hubspot_owner_id: 'owner',
}

const CONDITION_OPERATOR_LABELS: Record<string, string> = {
  equals: 'is',
  not_equals: 'is not',
  contains: 'contains',
}

/**
 * Works out what event to simulate, and what had to be invented to do it.
 *
 * Pure: no network, no database, and `now` is passed in. Everything a customer
 * is told about how their test differs from a real event is decided here.
 */
export function simulateTrigger(args: {
  workflow: WorkflowRow
  deal: HubSpotDeal
  ownerMap: Map<string, string>
  fingerprint: string
  now: number
}): Simulation {
  const { workflow, deal, ownerMap, fingerprint, now } = args
  const currentStage = deal.properties.dealstage
  const simulated: string[] = []

  let event: TriggerEvent
  let dealStage = currentStage

  switch (workflow.trigger_type) {
    case 'deal_created':
      event = { type: 'deal_created', fingerprint }
      break

    case 'deal_stage_changed': {
      const target = workflow.trigger_config.to_stage?.trim() || null
      const newStage = target ?? currentStage ?? 'unknown'
      if (target && target !== currentStage) {
        simulated.push(
          `Moved into "${target}" — this deal is actually in ${currentStage ? `"${currentStage}"` : 'no stage'}.`
        )
      } else if (!target && !currentStage) {
        simulated.push('This deal has no stage, so the test reports it as "unknown".')
      }
      event = { type: 'deal_stage_changed', fingerprint, newStage }
      dealStage = newStage
      break
    }

    case 'deal_stale': {
      const thresholdDays = workflow.trigger_config.threshold_days ?? 0
      const lastActivity = deal.properties.notes_last_updated
        ? new Date(deal.properties.notes_last_updated).getTime()
        : NaN
      const realDays = Number.isNaN(lastActivity)
        ? null
        : Math.max(0, Math.floor((now - lastActivity) / MS_PER_DAY))

      let daysStale: number
      if (realDays === null) {
        daysStale = thresholdDays
        simulated.push(
          `Stale for ${thresholdDays} days — no activity has ever been logged on this deal, so its age is taken as the threshold.`
        )
      } else if (realDays < thresholdDays) {
        daysStale = thresholdDays
        simulated.push(
          `Stale for ${thresholdDays} days — this deal's last activity was ${realDays} day${realDays === 1 ? '' : 's'} ago.`
        )
      } else {
        daysStale = realDays
      }
      event = { type: 'deal_stale', fingerprint, thresholdDays, daysStale }
      break
    }
  }

  // The condition is judged against the deal as the run will describe it, so a
  // condition on stage sees the stage the trigger moved it into — as it would
  // for a real event, where the stage has already changed by the time it runs.
  const asRun: HubSpotDeal = { ...deal, properties: { ...deal.properties, dealstage: dealStage } }
  let conditionNote: string | null = null
  if (
    workflow.condition_property &&
    workflow.condition_operator &&
    workflow.condition_value !== null &&
    !workflowMatchesCondition(workflow, asRun, ownerMap)
  ) {
    const property = CONDITION_PROPERTY_LABELS[workflow.condition_property] ?? workflow.condition_property
    const operator = CONDITION_OPERATOR_LABELS[workflow.condition_operator] ?? workflow.condition_operator
    const actual = getDealPropertyValue(asRun, workflow.condition_property, ownerMap)
    conditionNote =
      `This deal doesn't meet the workflow's condition — ${property} ${operator} "${workflow.condition_value}", ` +
      `and this deal's ${property} is ${actual ? `"${actual}"` : 'empty'} — so a real event would not run it. ` +
      `The test runs anyway, so you can see what it sends.`
  }

  return { event, dealStage, simulated, conditionNote }
}

export type TestStepResult = {
  index: number
  label: string
  status: 'success' | 'failed' | 'not_run'
  output: string | null
  error: string | null
}

type RunRow = {
  step_index: number
  status: string
  output: string | null
  error_message: string | null
}

/**
 * Turns the ledger rows a test wrote into one result per configured step.
 *
 * Read back from workflow_runs rather than tracked separately: the ledger is
 * what records what actually happened, and a second account of the same run
 * kept alongside it could disagree with it. A step with no row never started —
 * a run stops at its first failure.
 */
export function summarizeTestRun(steps: WorkflowStep[], rows: RunRow[]): TestStepResult[] {
  const byIndex = new Map(rows.map((r) => [r.step_index, r]))
  return steps.map((step, index) => {
    const label = ACTION_LABELS[step.action_type]
    const row = byIndex.get(index)
    if (!row) return { index, label, status: 'not_run', output: null, error: null }

    const output = row.output ? row.output.slice(0, OUTPUT_PREVIEW_CHARS) : null
    if (row.status === 'success') return { index, label, status: 'success', output, error: null }

    // Claimed but not marked success: either it failed, or it was interrupted
    // before it could be marked either way. Both are failures to the person
    // watching, and saying "pending" would suggest it might still finish.
    return {
      index,
      label,
      status: 'failed',
      output,
      error: row.error_message ?? 'This step did not finish.',
    }
  })
}

export type WorkflowTestResult = {
  ok: boolean
  dealName: string
  simulated: string[]
  conditionNote: string | null
  steps: TestStepResult[]
  /** A failure that happened before any step could be recorded. */
  error: string | null
}

/** A test that could not be started, with the status the route should return. */
export class WorkflowTestError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'WorkflowTestError'
    this.status = status
  }
}

export async function runWorkflowTest(args: {
  customerId: string
  workflowId: string
  dealId: string
}): Promise<WorkflowTestResult> {
  const { customerId, workflowId, dealId } = args
  const supabase = getSupabaseAdmin()

  const [{ data: workflow }, { data: hubspot }] = await Promise.all([
    supabase.from('workflows').select('*').eq('id', workflowId).eq('customer_id', customerId).maybeSingle(),
    supabase.from('hubspot_connections').select('hub_id').eq('customer_id', customerId).maybeSingle(),
  ])

  if (!workflow) throw new WorkflowTestError('Workflow not found.', 404)
  if (!hubspot) throw new WorkflowTestError('Connect HubSpot before testing a workflow.', 409)

  const row = workflow as WorkflowRow
  const steps = stepsFor(row)
  if (steps.length === 0) throw new WorkflowTestError('This workflow has no steps to test.', 422)

  // Fetched with the customer's own token, which is also the ownership check:
  // a deal ID from someone else's portal is simply not found with it.
  const token = await getValidHubSpotToken(customerId)
  const deal = await fetchDeal(customerId, token, dealId)
  if (!deal) throw new WorkflowTestError('That deal was not found in your HubSpot account.', 404)
  const ownerMap = await fetchOwnerMap(token)

  const fingerprint = `${TEST_FINGERPRINT_PREFIX}${randomUUID()}`
  const simulation = simulateTrigger({ workflow: row, deal, ownerMap, fingerprint, now: Date.now() })

  const ownerId = deal.properties.hubspot_owner_id
  const payload: ActionPayload = {
    workflowId,
    customerId,
    hubId: hubspot.hub_id,
    dealId: deal.id,
    dealName: deal.properties.dealname,
    dealStage: simulation.dealStage,
    ownerName: ownerId ? ownerMap.get(ownerId) ?? ownerId : 'Unassigned',
    event: simulation.event,
  }

  let runError: unknown = null
  try {
    await executeWorkflowAction(payload, { test: true })
  } catch (err) {
    runError = err
    // A test that finds a dead credential has found a true fact, and the
    // customer should see the same reconnect banner a live run would raise.
    if (err instanceof ConnectionError) await markConnectionUnhealthy(err)
  }

  const { data: rows } = await supabase
    .from('workflow_runs')
    .select('step_index, status, output, error_message')
    .eq('workflow_id', workflowId)
    .eq('customer_id', customerId)
    .eq('trigger_fingerprint', fingerprint)
    .order('step_index', { ascending: true })

  const results = summarizeTestRun(steps, (rows ?? []) as RunRow[])
  const recordedFailure = results.some((r) => r.status === 'failed')
  const error =
    runError && !recordedFailure
      ? runError instanceof Error
        ? runError.message
        : 'The test could not run.'
      : null

  return {
    ok: !error && results.every((r) => r.status === 'success'),
    dealName: deal.properties.dealname ?? 'Unnamed deal',
    simulated: simulation.simulated,
    conditionNote: simulation.conditionNote,
    steps: results,
    error,
  }
}
