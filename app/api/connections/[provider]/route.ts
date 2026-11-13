import { NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/session'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { recordAudit, clientIp, userAgent } from '@/lib/audit'
import { isConnectionProvider } from '@/lib/connections'
import { providerLabel } from '@/lib/connection-health'
import { disconnectConnection } from '@/lib/disconnect'

// Disconnect an integration: DELETE /api/connections/{hubspot|slack|notion}.
//
// What happens, and in what order, is in lib/disconnect.ts. This route only
// authenticates, rate limits, records the outcome and words it.
//
// The session cookie is SameSite=Lax, which a browser does not send on a
// cross-site DELETE, so another site cannot make a signed-in customer's
// browser disconnect anything.

export const dynamic = 'force-dynamic'

export async function DELETE(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { provider } = await params
  if (!isConnectionProvider(provider)) {
    return NextResponse.json({ error: 'Unknown integration' }, { status: 404 })
  }

  const limit = await checkRateLimit(`disconnect:${session.customerId}`, RATE_LIMITS.disconnect)
  if (!limit.allowed) return rateLimitResponse(limit)

  const name = providerLabel(provider)
  const result = await disconnectConnection(session.customerId, provider)

  if (result.status === 'not_connected') {
    return NextResponse.json({ error: `${name} is not connected.` }, { status: 404 })
  }

  if (result.status === 'failed') {
    // Recorded only when something already changed — workflows paused but the
    // connection still there — because that is a state someone may later need
    // to explain.
    if (result.pausedWorkflows.length > 0) {
      await recordAudit({
        action: 'connection.disconnect_failed',
        customerId: session.customerId,
        actor: session.email,
        metadata: { provider, stage: result.stage, workflows_paused: result.pausedWorkflows.length },
        ip: clientIp(req),
        userAgent: userAgent(req),
      })
    }

    const error =
      result.stage === 'delete'
        ? `The workflows that use ${name} were paused, but ${name} could not be disconnected. Please try again.`
        : `Nothing was changed — ${name} could not be disconnected. Please try again.`
    return NextResponse.json({ error, pausedWorkflows: result.pausedWorkflows }, { status: 500 })
  }

  await recordAudit({
    action: 'connection.disconnected',
    customerId: session.customerId,
    actor: session.email,
    // The outcome and the counts. Never the provider's response text, and no
    // credential, webhook URL or workflow name.
    metadata: {
      provider,
      revocation: result.revocation.outcome,
      workflows_paused: result.pausedWorkflows.length,
      cleanup_complete: result.cleanupComplete,
    },
    ip: clientIp(req),
    userAgent: userAgent(req),
  })

  return NextResponse.json({
    ok: true,
    provider,
    revocation: result.revocation.outcome,
    pausedWorkflows: result.pausedWorkflows,
    cleanupComplete: result.cleanupComplete,
  })
}
