import { NextResponse } from 'next/server'
import { runJobs, enqueue } from '@/lib/jobs'
import { registerJobHandlers } from '@/lib/job-handlers'
import { runNotificationSweep } from '@/lib/notify'
import { runOperatorAlert, countOverdueJobs } from '@/lib/ops-alert'
import { enforceAllEntitlements } from '@/lib/entitlement-enforcement'
import { sendHeartbeat } from '@/lib/heartbeat'
import { sweepIsDue } from '@/lib/worker-cadence'

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

// When this instance last completed the sweeps. In memory on purpose — see
// lib/worker-cadence.ts: a fresh instance always sweeps on its first call.
let lastSweepAt: number | null = null

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  registerJobHandlers()

  const startedAt = Date.now()

  // The drain runs on every call; the sweeps below only once per interval.
  // Running all of them every minute was ~23,000 requests a day against a
  // shared egress quota — see lib/worker-cadence.ts.
  const sweep = sweepIsDue(lastSweepAt, startedAt)

  // Before the drain, deliberately: a count taken afterwards would have had
  // the claimable jobs removed from it, and could never show a queue that
  // earlier runs failed to clear. Only the operator alert reads it, so it is
  // only taken when that will run.
  const overdueJobs = sweep ? await countOverdueJobs() : undefined
  const result = await runJobs({
    // Leave headroom under maxDuration so the loop stops claiming and returns
    // rather than being killed. A killed worker's jobs wait out a 5-minute
    // lease before anything retries them.
    budgetMs: 45_000,
    batchSize: 20,
  })

  let enforced: Awaited<ReturnType<typeof enforceAllEntitlements>> | null = null
  let notified: Awaited<ReturnType<typeof runNotificationSweep>> | null = null
  let ops: Awaited<ReturnType<typeof runOperatorAlert>> | null = null

  if (sweep) {
    // Housekeeping is itself a job, so it retries like anything else and never
    // competes with delivery for this request's time budget. With the pinger
    // calling every minute, sweeps come at most fifteen minutes apart, so at
    // least one lands inside hour 4; without it, the daily Vercel cron runs in
    // hour 4 and nearly always sweeps. A day the purge misses is harmless — it
    // only deletes old rows, and the next day's purge catches them.
    if (new Date().getUTCHours() === 4) {
      await enqueue({
        kind: 'maintenance.purge',
        // One purge per day: the key collapses repeat enqueues within the hour.
        idempotencyKey: `maintenance.purge:${new Date().toISOString().slice(0, 10)}`,
      }).catch(() => {})
    }

    // A subscription can lapse by the clock rather than by webhook — a comp
    // with an end date, or a customer.subscription.deleted that never arrived.
    // Nothing would notice, so the enforcement runs here too and not only on
    // the webhook.
    enforced = await enforceAllEntitlements()

    // The digest is deliberately downstream of both: a connection that just
    // died, or a workflow just paused, gets reported in this sweep rather than
    // waiting a further day for the next one.
    notified = await runNotificationSweep()

    // And the half of that nobody was getting: conditions a customer cannot
    // fix, reported to whoever runs this.
    ops = await runOperatorAlert(overdueJobs)

    // Only once all of them have finished: if one throws, the request fails
    // and the next call tries the sweeps again instead of waiting out an
    // interval in which they never ran.
    lastSweepAt = startedAt
  }

  // Healthy means the queue could be read — not merely that the handler got
  // this far. An unreachable database used to come back as claimed: 0 and a
  // 200, indistinguishable from an empty queue. See lib/heartbeat.ts.
  const healthy = !result.claimFailed

  // Last, so that anything above throwing means no heartbeat. The switch only
  // works if a broken run is silent.
  const heartbeat = await sendHeartbeat({ healthy })

  const ms = Date.now() - startedAt
  if (result.claimed > 0) {
    console.log(
      `[jobs] ${result.claimed} claimed, ${result.succeeded} ok, ${result.retried} retrying, ${result.dead} dead (${ms}ms)`
    )
  }

  return NextResponse.json(
    { ok: healthy, ...result, swept: sweep, enforced, notified, ops, heartbeat, durationMs: ms },
    // A run that could not reach the queue is a failure, and every caller
    // should see one: pg_net records the status, and the GitHub workflow fails
    // loudly on anything but 200.
    { status: healthy ? 200 : 503 }
  )
}
