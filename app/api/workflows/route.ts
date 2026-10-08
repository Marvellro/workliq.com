import { NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/session'
import { getSupabaseAdmin } from '@/lib/config'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { recordAudit, clientIp, userAgent } from '@/lib/audit'
import { getEntitlements, checkWorkflowLimit } from '@/lib/plans'
import { validateWorkflowInput, stepsFromBody } from '@/lib/workflow-validation'

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
  } = body

  // A workflow is a list of steps. The single action_type/action_config pair is
  // still accepted so anything built against the old shape keeps working — it
  // is simply a one-step workflow, which is what it always was.
  const steps = stepsFromBody(body)

  const entitlements = await getEntitlements(session.customerId)

  // Shared with the edit path. A rule enforced on create and not on edit is not
  // a rule, and the edit path becomes the way around it.
  const invalid = await validateWorkflowInput(
    { name, trigger_type, trigger_config, condition_property, condition_operator, steps },
    entitlements
  )
  if (invalid) {
    return NextResponse.json({ error: invalid.error }, { status: invalid.status })
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
    // Step types only, never action_config: for a webhook step it holds the
    // customer's endpoint URL, which the audit log should not carry.
    metadata: {
      workflow_id: data.id,
      trigger_type,
      step_types: steps.map((step) => step.action_type),
    },
    ip: clientIp(req),
    userAgent: userAgent(req),
  })

  return NextResponse.json({ workflow: data }, { status: 201 })
}
