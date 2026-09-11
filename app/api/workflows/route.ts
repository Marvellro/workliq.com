import { NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/session'
import { getSupabaseAdmin } from '@/lib/config'
import { validateWebhookUrl, BlockedAddressError } from '@/lib/safe-fetch'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { recordAudit, clientIp, userAgent } from '@/lib/audit'

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
  } = body

  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!TRIGGER_TYPES.includes(trigger_type)) {
    return NextResponse.json({ error: 'Invalid trigger_type' }, { status: 400 })
  }
  if (!ACTION_TYPES.includes(action_type)) {
    return NextResponse.json({ error: 'Invalid action_type' }, { status: 400 })
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
  if (action_type === 'ai_step') {
    if (!AI_TASKS.includes(action_config?.ai_task)) {
      return NextResponse.json(
        { error: `ai_step requires action_config.ai_task (${AI_TASKS.join(' | ')})` },
        { status: 400 }
      )
    }
    if (action_config?.deliver_to && !AI_DELIVERY.includes(action_config.deliver_to)) {
      return NextResponse.json(
        { error: `ai_step deliver_to must be one of ${AI_DELIVERY.join(' | ')}` },
        { status: 400 }
      )
    }
    const instructions = action_config?.ai_instructions
    if (instructions !== undefined && instructions !== null) {
      if (typeof instructions !== 'string' || instructions.length > MAX_AI_INSTRUCTIONS) {
        return NextResponse.json(
          { error: `ai_instructions must be text under ${MAX_AI_INSTRUCTIONS} characters` },
          { status: 400 }
        )
      }
    }
  }

  if (action_type === 'webhook') {
    const url = action_config?.url
    if (typeof url !== 'string') {
      return NextResponse.json({ error: 'webhook requires action_config.url' }, { status: 400 })
    }
    // A `startsWith('https://')` check was all this used to do, which allowed
    // https://169.254.169.254 and every other internal target. validateWebhookUrl
    // resolves the host and rejects private/loopback/link-local addresses.
    //
    // This is a save-time convenience check that gives the customer immediate
    // feedback; DNS can change afterwards, so lib/safe-fetch.ts re-validates on
    // every delivery. That is the actual boundary.
    try {
      await validateWebhookUrl(url)
    } catch (err) {
      if (err instanceof BlockedAddressError) {
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
      throw err
    }
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
      action_type,
      action_config: action_config ?? {},
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
