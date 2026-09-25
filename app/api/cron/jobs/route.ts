import { NextResponse } from 'next/server'
import { runJobs, enqueue } from '@/lib/jobs'
import { registerJobHandlers } from '@/lib/job-handlers'
import { runNotificationSweep } from '@/lib/notify'

// The queue worker.
//
// Runs frequently and drains whatever is due: workflow deliveries queued by the
// webhook receiver or the reconciliation sweep, plus their retries. This is the
// only place customer-facing side effects (Slack, Notion, outbound webhooks)
// actually happen.
//
// This is the backstop, not the fast path. On Hobby, Vercel refuses any cron
// more frequent than daily (see vercel.json), so delivery latency comes from the
// webhook receivers draining the queue in `after()` — see lib/scheduling.md.
// What this run is actually for is everything that missed that: retries whose
// backoff has elapsed, and jobs enqueued by a path with no request behind it.

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

  // The digest is deliberately downstream of the drain in the same request: a
  // connection that just died gets reported in this run rather than waiting a
  // further day for the next one.
  const notified = await runNotificationSweep()

  const ms = Date.now() - startedAt
  if (result.claimed > 0) {
    console.log(
      `[jobs] ${result.claimed} claimed, ${result.succeeded} ok, ${result.retried} retrying, ${result.dead} dead (${ms}ms)`
    )
  }

  return NextResponse.json({ ok: true, ...result, notified, durationMs: ms })
}
