import { NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/session'
import { getSupabaseAdmin } from '@/lib/config'
import { validateWebhookUrl, BlockedAddressError } from '@/lib/safe-fetch'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { recordAudit, clientIp, userAgent } from '@/lib/audit'
import { getEntitlements, checkWorkflowLimit, checkActionAllowed } from '@/lib/plans'
import { validateSteps, type WorkflowStep } from '@/lib/workflow-steps'

const TRIGGER_TYPES = ['deal_stage_changed', 'deal_created', 'deal_stale']
const ACTION_TYPES = ['slack_message', 'notion_row', 'webhook', 'ai_step']
const AI_TASKS = ['summarize', 'draft_followup', 'score_lead', 'next_action']
const AI_DELIVERY = ['slack_message', 'notion_row']
// Free-text guidance is forwarded to the model. Bounded so a workflow cannot
// be used to push an arbitrarily large prompt through our API key.
const MAX_AI_INSTRUCTIONS = 500
const CONDITION_OPERATORS = ['equals', 'not_equals', 'contains']
// Must match the properties workflow-engine.ts's getDealPropertyValue()
// actually knows how to read. An unrecognized property always resolves to
// null, which makes 'not_equals' silently match every deal (fail-open) —
// validating here at write time keeps that failure mode out of reach.
const CONDITION_PROPERTIES = ['dealstage', 'dealname', 'hubspot_owner_id']

export async function GET() {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('customer_id', session.customerId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Failed to load workflows' }, { status: 500 })
  return NextResponse.json({ workflows: data })
}

export async function POST(req: Request) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limit = await checkRateLimit(
    `workflow:${session.customerId}`,
    RATE_LIMITS.workflowWrite
  )
  if (!limit.allowed) return rateLimitResponse(limit)

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const {
    name,
    trigger_type,
    trigger_config,
    condition_property,
    condition_operator,
    condition_value,
    action_type,
    action_config,
    steps: rawSteps,
  } = body

  // A workflow is a list of steps. The single action_type/action_config pair is
  // still accepted so anything built against the old shape keeps working — it
  // is simply a one-step workflow, which is what it always was.
  const steps: WorkflowStep[] = Array.isArray(rawSteps)
    ? rawSteps
    : [{ action_type, action_config: action_config ?? {} }]

  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!TRIGGER_TYPES.includes(trigger_type)) {
    return NextResponse.json({ error: 'Invalid trigger_type' }, { status: 400 })
  }
  if (condition_operator && !CONDITION_OPERATORS.includes(condition_operator)) {
    return NextResponse.json({ error: 'Invalid condition_operator' }, { status: 400 })
  }
  if (condition_property && !CONDITION_PROPERTIES.includes(condition_property)) {
    return NextResponse.json({ error: 'Invalid condition_property' }, { status: 400 })
  }
  if (trigger_type === 'deal_stale') {
    const threshold = trigger_config?.threshold_days
    if (typeof threshold !== 'number' || threshold <= 0) {
      return NextResponse.json({ error: 'deal_stale requires trigger_config.threshold_days' }, { status: 400 })
    }
  }
  // ── Steps ──────────────────────────────────────────────────────────────────
  // Shape first, in one place, so every rule reads the same whether a workflow
  // has one step or ten.
  const shapeError = validateSteps(steps)
  if (shapeError) {
    return NextResponse.json({ error: shapeError }, { status: 400 })
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const config = step.action_config ?? {}
    const position = i + 1

    if (!ACTION_TYPES.includes(step.action_type)) {
      return NextResponse.json({ error: `Step ${position} has an invalid action type` }, { status: 400 })
    }

    if (step.action_type === 'ai_step') {
      if (!AI_TASKS.includes(config.ai_task as string)) {
        return NextResponse.json(
          { error: `Step ${position}: an AI step needs a task (${AI_TASKS.join(' | ')})` },
          { status: 400 }
        )
      }
      if (config.deliver_to && !AI_DELIVERY.includes(config.deliver_to)) {
        return NextResponse.json(
          { error: `Step ${position}: deliver_to must be one of ${AI_DELIVERY.join(' | ')}` },
          { status: 400 }
        )
      }
      const instructions = config.ai_instructions
      if (instructions !== undefined && instructions !== null) {
        if (typeof instructions !== 'string' || instructions.length > MAX_AI_INSTRUCTIONS) {
          return NextResponse.json(
            { error: `Step ${position}: instructions must be text under ${MAX_AI_INSTRUCTIONS} characters` },
            { status: 400 }
          )
        }
      }
    }

    if (step.action_type === 'webhook') {
      const url = config.url
      if (typeof url !== 'string') {
        return NextResponse.json({ error: `Step ${position} needs a URL` }, { status: 400 })
      }
      // A `startsWith('https://')` check was all this used to do, which allowed
      // https://169.254.169.254 and every other internal target.
      // validateWebhookUrl resolves the host and rejects private/loopback/
      // link-local addresses.
      //
      // This is a save-time convenience check that gives the customer immediate
      // feedback; DNS can change afterwards, so lib/safe-fetch.ts re-validates
      // on every delivery. That is the actual boundary.
      try {
        await validateWebhookUrl(url)
      } catch (err) {
        if (err instanceof BlockedAddressError) {
          return NextResponse.json({ error: `Step ${position}: ${err.message}` }, { status: 400 })
        }
        throw err
      }
    }
  }

  // Plan limits. Checked here rather than in the UI alone — the UI can be
  // bypassed by calling the API directly, so this is the enforcement point and
  // the UI is only the courtesy that stops someone hitting it by surprise.
  const entitlements = await getEntitlements(session.customerId)

  // Every step is gated, not only the first. Otherwise a free account could put
  // a Slack step in front of an AI step and have the plan check wave the whole
  // workflow through on the strength of step one.
  for (let i = 0; i < steps.length; i++) {
    const actionAllowed = checkActionAllowed(steps[i].action_type, entitlements)
    if (!actionAllowed.allowed) {
      return NextResponse.json(
        { error: `Step ${i + 1}: ${actionAllowed.reason}`, upgradeTo: actionAllowed.upgradeTo },
        { status: 402 }
      )
    }
  }

  const withinLimit = await checkWorkflowLimit(session.customerId, entitlements)
  if (!withinLimit.allowed) {
    return NextResponse.json(
      { error: withinLimit.reason, upgradeTo: withinLimit.upgradeTo },
      { status: 402 }
    )
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('workflows')
    .insert({
      customer_id: session.customerId,
      name: name.trim(),
      trigger_type,
      trigger_config: trigger_config ?? {},
      condition_property: condition_property || null,
      condition_operator: condition_operator || null,
      condition_value: condition_value || null,
      steps,
      enabled: true,
    })
    .select()
    .single()

  if (error) {
    console.error('[api/workflows] insert failed:', error)
    return NextResponse.json({ error: 'Failed to create workflow' }, { status: 500 })
  }

  await recordAudit({
    action: 'workflow.created',
    customerId: session.customerId,
    actor: session.email,
    // No action_config here: for a webhook workflow it holds the customer's
    // endpoint URL, which the audit log should not carry.
    metadata: { workflow_id: data.id, trigger_type, action_type },
    ip: clientIp(req),
    userAgent: userAgent(req),
  })

  return NextResponse.json({ workflow: data }, { status: 201 })
}
