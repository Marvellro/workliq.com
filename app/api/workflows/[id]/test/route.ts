import { NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/session'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { recordAudit, clientIp, userAgent } from '@/lib/audit'
import { ConnectionError, markConnectionUnhealthy } from '@/lib/connection-health'
import { runWorkflowTest, WorkflowTestError } from '@/lib/workflow-test'

// Runs one workflow now, against a deal the customer picks. See
// lib/workflow-test.ts for what a test is and how it differs from a real event.

// A test runs inline: an AI step plus a webhook can take tens of seconds, and
// the person who pressed the button is waiting for the answer.
export const maxDuration = 60

// HubSpot deal IDs are numeric. Checked here so nothing else reaches the
// HubSpot URL it is interpolated into.
const DEAL_ID = /^\d{1,20}$/

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => null)
  const dealId = typeof body?.dealId === 'string' ? body.dealId.trim() : ''
  if (!DEAL_ID.test(dealId)) {
    return NextResponse.json({ error: 'Choose a deal to test against.' }, { status: 400 })
  }

  // Checked before any work, and counted even when the test then fails: the
  // limit exists because each attempt can send real messages, and a failing
  // attempt can have sent some before it stopped.
  const limit = await checkRateLimit(`workflow-test:${session.customerId}`, RATE_LIMITS.workflowTest)
  if (!limit.allowed) return rateLimitResponse(limit)

  try {
    const result = await runWorkflowTest({ customerId: session.customerId, workflowId: id, dealId })

    await recordAudit({
      action: 'workflow.tested',
      customerId: session.customerId,
      actor: session.email,
      // Statuses only. Never outputs — an AI step's text can carry anything —
      // and never step configuration, which for a webhook is the customer's
      // endpoint URL.
      metadata: {
        workflow_id: id,
        deal_id: dealId,
        ok: result.ok,
        step_statuses: result.steps.map((s) => s.status),
      },
      ip: clientIp(req),
      userAgent: userAgent(req),
    })

    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof WorkflowTestError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    // Reached when HubSpot itself refuses (the token or the deal fetch), before
    // any step ran. Step-level connection failures are handled inside the run
    // and come back as a failed step instead.
    if (err instanceof ConnectionError) {
      await markConnectionUnhealthy(err)
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    console.error('[workflow-test] failed:', err)
    return NextResponse.json({ error: 'The test could not run. Try again in a moment.' }, { status: 500 })
  }
}
