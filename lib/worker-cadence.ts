// How often the worker's sweeps run, as distinct from the drain.
//
// pg_cron calls the worker every minute (021_queue_pinger.sql). The drain has to
// run that often — it is what delivers retries — and when the queue is empty it
// costs one database call. The sweeps riding along with it cost fifteen more:
// entitlement enforcement, the customer digest, and the operator alert, each a
// handful of small reads that almost always come back empty.
//
// Every one of those calls is metered. Supabase counts egress per request, and
// a request that answers "nothing" still pays for its TLS handshake (~2.8 KB)
// and response headers (~1 KB). At sixteen calls a minute that was roughly
// 23,000 requests a day of an idle worker asking whether anything had changed,
// and on 16 Nov 2026 it ran the Free plan's 5 GB egress quota out: Supabase
// restricted the project and every database call — sign-in, webhooks, the queue
// itself — failed with exceed_egress_quota.
//
// None of the sweeps needs minute resolution. A digest about a broken
// connection, a workflow paused by a lapsed plan, an operator alert about a
// stalled queue: fifteen minutes late is still timely. The drain stays every
// minute; the sweeps run once per interval.

export const SWEEP_INTERVAL_MS = 15 * 60_000

/**
 * Whether this invocation should run the sweeps.
 *
 * @param lastSweepAt when this server instance last completed them, or null if
 *   it never has. Deliberately per instance, held in memory: a fresh instance
 *   always sweeps on its first call, so a gap in callers — pg_cron down, only
 *   the daily Vercel cron or GitHub's sparse schedule arriving — can never skip
 *   a sweep. The cost of that is an occasional extra sweep when instances
 *   recycle, which is the safe direction to be wrong in.
 */
export function sweepIsDue(
  lastSweepAt: number | null,
  now: number,
  intervalMs: number = SWEEP_INTERVAL_MS
): boolean {
  if (lastSweepAt === null) return true
  // A clock that moved backwards says nothing about how long it has been, so
  // sweep rather than wait out an interval that may already have passed.
  if (now < lastSweepAt) return true
  return now - lastSweepAt >= intervalMs
}
