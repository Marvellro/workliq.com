import { NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/session'
import { getSupabaseAdmin } from '@/lib/config'
import { enqueue } from '@/lib/jobs'

// Activity feed: what each workflow actually did, and what is still pending.
//
// Before this there was no way for a customer to answer "did my alert fire?"
// other than checking Slack. A failed delivery was a console line on a server
// they cannot see.

export async function GET(req: Request) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') ?? 50), 200)
  const supabase = getSupabaseAdmin()

  const [runs, queued] = await Promise.all([
    supabase
      .from('workflow_runs')
      .select('id, workflow_id, deal_id, trigger_fingerprint, status, error_message, fired_at, workflows(name, action_type)')
      .eq('customer_id', session.customerId)
      .order('fired_at', { ascending: false })
      .limit(limit),
    // Pending and dead jobs are the part of the picture workflow_runs can't
    // show: work that is queued but hasn't been attempted, or that exhausted
    // its retries.
    supabase
      .from('jobs')
      .select('id, kind, status, attempts, max_attempts, last_error, run_after, created_at')
      .eq('customer_id', session.customerId)
      .in('status', ['pending', 'running', 'dead'])
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  if (runs.error) {
    console.error('[api/runs] failed:', runs.error.message)
    return NextResponse.json({ error: 'Failed to load activity' }, { status: 500 })
  }

  return NextResponse.json({
    runs: runs.data ?? [],
    queue: queued.data ?? [],
  })
}

/**
 * Replays a dead job.
 *
 * A job that exhausted its retries is kept, never deleted — it is the record of
 * an automation that silently didn't happen. Once the cause is fixed (a Slack
 * channel recreated, a webhook endpoint brought back up), this makes it
 * runnable again rather than requiring the customer to recreate the event.
 */
export async function POST(req: Request) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const jobId = body?.jobId
  if (typeof jobId !== 'string') {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // Scoped to this customer: the service-role key would otherwise happily
  // replay anyone's job.
  const { data: job, error } = await supabase
    .from('jobs')
    .select('id, kind, payload, status')
    .eq('id', jobId)
    .eq('customer_id', session.customerId)
    .maybeSingle()

  if (error || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  if (job.status !== 'dead') {
    return NextResponse.json(
      { error: 'Only jobs that exhausted their retries can be replayed' },
      { status: 400 }
    )
  }

  // A fresh job rather than resetting the old one, so the dead row survives as
  // the historical record of the original failure.
  //
  // No idempotency key: the partial unique index only covers pending/running
  // jobs, so the dead original does not block this — and a replay is an
  // explicit human decision to try again, which is exactly when the automatic
  // duplicate-suppression should step aside. executeWorkflowAction still
  // checks workflow_runs, so a delivery that actually succeeded won't repeat.
  const newId = await enqueue({
    kind: job.kind as 'workflow.action' | 'hubspot.event',
    customerId: session.customerId,
    payload: job.payload as Record<string, unknown>,
  })

  return NextResponse.json({ ok: true, jobId: newId })
}
