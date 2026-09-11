import { NextResponse } from 'next/server'
import { runJobs, enqueue } from '@/lib/jobs'
import { registerJobHandlers } from '@/lib/job-handlers'

// The queue worker.
//
// Runs frequently and drains whatever is due: workflow deliveries queued by the
// webhook receiver or the reconciliation sweep, plus their retries. This is the
// only place customer-facing side effects (Slack, Notion, outbound webhooks)
// actually happen.
//
// Vercel's cron granularity is one minute, which sets the floor on delivery
// latency from the queue. Combined with webhook ingestion, that takes end-to-end
// latency from ~24 hours to roughly a minute. If that ever needs to be seconds,
// the webhook handler can invoke the worker directly — the queue semantics do
// not change.

export const dynamic = 'force-dynamic'
// Vercel caps this per plan; the worker's own budget stays below it so jobs are
// released cleanly rather than killed mid-flight.
export const maxDuration = 60

const CRON_SECRET = process.env.CRON_SECRET

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  registerJobHandlers()

  const startedAt = Date.now()
  const result = await runJobs({
    // Leave headroom under maxDuration so the loop stops claiming and returns
    // rather than being killed. A killed worker's jobs wait out a 5-minute
    // lease before anything retries them.
    budgetMs: 45_000,
    batchSize: 20,
  })

  // Housekeeping is itself a job, so it retries like anything else and never
  // competes with delivery for this request's time budget.
  if (new Date().getUTCHours() === 4) {
    await enqueue({
      kind: 'maintenance.purge',
      // One purge per day: the key collapses repeat enqueues within the hour.
      idempotencyKey: `maintenance.purge:${new Date().toISOString().slice(0, 10)}`,
    }).catch(() => {})
  }

  const ms = Date.now() - startedAt
  if (result.claimed > 0) {
    console.log(
      `[jobs] ${result.claimed} claimed, ${result.succeeded} ok, ${result.retried} retrying, ${result.dead} dead (${ms}ms)`
    )
  }

  return NextResponse.json({ ok: true, ...result, durationMs: ms })
}
