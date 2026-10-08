import { NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/session'
import { getSupabaseAdmin } from '@/lib/config'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { recordAudit, clientIp, userAgent } from '@/lib/audit'
import { getEntitlements, checkWorkflowLimit } from '@/lib/plans'
import { validateWorkflowInput, stepsFromBody } from '@/lib/workflow-validation'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  // Two shapes, deliberately kept apart.
  //
  // { enabled } toggles a workflow and touches nothing else. Anything carrying
  // a name is a full edit of the definition, and goes through exactly the
  // validation the create path uses.
  //
  // Before this, PATCH accepted `enabled` and nothing else — so changing a
  // message template meant deleting the workflow and rebuilding it. Tolerable
  // when a workflow was one action; not once it can have ten steps.
  const isToggle = typeof body.enabled === 'boolean' && body.name === undefined
  if (!isToggle && typeof body.name !== 'string') {
    return NextResponse.json(
      { error: 'Send { enabled } to turn a workflow on or off, or a full workflow to edit it.' },
      { status: 400 }
    )
  }

  const entitlements = await getEntitlements(session.customerId)

  // Enabling counts against the plan limit, not just creating.
  //
  // Without this, the limit is trivially bypassed: create one workflow, disable
  // it, create another (the create check counts only *enabled* ones), then
  // enable both. Creation and enabling are two doors into the same room, so
  // both need the same lock.
  if (body.enabled === true) {
    const withinLimit = await checkWorkflowLimit(session.customerId, entitlements)
    if (!withinLimit.allowed) {
      return NextResponse.json(
        { error: withinLimit.reason, upgradeTo: withinLimit.upgradeTo },
        { status: 402 }
      )
    }
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (typeof body.enabled === 'boolean') update.enabled = body.enabled

  if (!isToggle) {
    // An edit is rate limited like a create. Each webhook step resolves DNS at
    // save time, so an unlimited edit endpoint is an unlimited way to make this
    // server perform lookups on demand.
    const limit = await checkRateLimit(
      `workflow:${session.customerId}`,
      RATE_LIMITS.workflowWrite
    )
    if (!limit.allowed) return rateLimitResponse(limit)

    const steps = stepsFromBody(body)

    const invalid = await validateWorkflowInput(
      {
        name: body.name,
        trigger_type: body.trigger_type,
        trigger_config: body.trigger_config,
        condition_property: body.condition_property,
        condition_operator: body.condition_operator,
        steps,
      },
      entitlements
    )
    if (invalid) {
      return NextResponse.json({ error: invalid.error }, { status: invalid.status })
    }

    update.name = (body.name as string).trim()
    update.trigger_type = body.trigger_type
    update.trigger_config = body.trigger_config ?? {}
    update.condition_property = body.condition_property || null
    update.condition_operator = body.condition_property ? body.condition_operator : null
    update.condition_value = body.condition_property
      ? (body.condition_value as string)?.trim() || null
      : null
    update.steps = steps
  }

  const supabase = getSupabaseAdmin()

  // Scope the update to this customer's own row — the service role key would
  // otherwise happily update any workflow regardless of owner.
  const { data, error } = await supabase
    .from('workflows')
    .update(update)
    .eq('id', id)
    .eq('customer_id', session.customerId)
    .select()
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  await recordAudit({
    action: isToggle
      ? body.enabled
        ? 'workflow.enabled'
        : 'workflow.disabled'
      : 'workflow.updated',
    customerId: session.customerId,
    actor: session.email,
    // Step types only, never action_config: for a webhook step it holds the
    // customer's endpoint URL, which the audit log should not carry.
    metadata: isToggle
      ? { workflow_id: id }
      : {
          workflow_id: id,
          trigger_type: body.trigger_type,
          step_types: (update.steps as { action_type: string }[]).map((s) => s.action_type),
        },
    ip: clientIp(req),
    userAgent: userAgent(req),
  })

  return NextResponse.json({ workflow: data })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = getSupabaseAdmin()

  const { error, count } = await supabase
    .from('workflows')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('customer_id', session.customerId)

  if (error) return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  if (!count) return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })

  await recordAudit({
    action: 'workflow.deleted',
    customerId: session.customerId,
    actor: session.email,
    metadata: { workflow_id: id },
    ip: clientIp(req),
    userAgent: userAgent(req),
  })

  return NextResponse.json({ ok: true })
}
