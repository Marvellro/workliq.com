import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from './config'

// Client for the durable job queue (see 008_job_queue.sql).
//
// The queue exists so that a failed action is retried instead of lost. Before
// it, every workflow action got exactly one attempt inside the cron request:
// a Slack blip or a customer webhook returning 502 meant the customer simply
// never received their alert.
//
// The interface here is deliberately small — enqueue, run, and the handler
// registry — so the Postgres backend can be replaced later without touching
// any caller.

export type JobKind =
  | 'workflow.action'      // execute one workflow action for one deal event
  | 'hubspot.event'        // process one inbound HubSpot webhook event
  | 'stripe.event'         // apply one inbound Stripe billing event
  | 'maintenance.purge'    // housekeeping

export type JobRecord = {
  id: string
  customer_id: string | null
  kind: string
  payload: Record<string, unknown>
  idempotency_key: string | null
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'dead'
  attempts: number
  max_attempts: number
  last_error: string | null
}

export type EnqueueOptions = {
  kind: JobKind
  customerId?: string | null
  payload?: Record<string, unknown>
  /**
   * Collapses duplicate enqueues of the same logical work. This is what makes
   * the pipeline safe to re-run: a webhook HubSpot delivers twice, or a
   * reconciliation poll re-observing an event the webhook already reported,
   * must not fire the customer's action a second time.
   */
  idempotencyKey?: string
  maxAttempts?: number
  /** Seconds to wait before the job becomes runnable. */
  delaySeconds?: number
}

/**
 * Adds a job to the queue.
 *
 * Returns the job id, or null when an identical unfinished job already exists
 * — the caller should treat null as success, not failure: the work is already
 * scheduled.
 */
export async function enqueue(opts: EnqueueOptions): Promise<string | null> {
  const supabase = getSupabaseAdmin()

  const row: Record<string, unknown> = {
    kind: opts.kind,
    customer_id: opts.customerId ?? null,
    payload: opts.payload ?? {},
    idempotency_key: opts.idempotencyKey ?? null,
  }
  if (opts.maxAttempts !== undefined) row.max_attempts = opts.maxAttempts
  if (opts.delaySeconds) {
    row.run_after = new Date(Date.now() + opts.delaySeconds * 1000).toISOString()
  }

  const { data, error } = await supabase.from('jobs').insert(row).select('id').single()

  if (error) {
    // 23505 = unique_violation against jobs_idempotency_idx. Expected and
    // benign: it means this exact work is already queued or in flight.
    if (error.code === '23505') return null
    throw new Error(`Failed to enqueue ${opts.kind}: ${error.message}`)
  }

  return data.id
}

// ── Handler registry ─────────────────────────────────────────────────────────

/**
 * A job handler.
 *
 * MUST be idempotent. A job can run more than once even without a retry: a
 * worker killed mid-execution (serverless timeout, deploy, OOM) never records
 * its result, so its lease expires and the job is reclaimed — possibly after
 * the side effect already happened.
 *
 * Throw `PermanentJobError` for failures retrying cannot fix (a deleted
 * endpoint, a malformed config). Anything else is treated as transient and
 * retried with backoff.
 */
export type JobHandler = (job: JobRecord) => Promise<void>

export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PermanentJobError'
  }
}

const handlers = new Map<string, JobHandler>()

export function registerHandler(kind: JobKind, handler: JobHandler): void {
  handlers.set(kind, handler)
}

// ── Worker ───────────────────────────────────────────────────────────────────

export type RunResult = {
  claimed: number
  succeeded: number
  retried: number
  dead: number
}

/**
 * Claims and runs a batch of jobs.
 *
 * `budgetMs` stops the worker claiming more work than it can finish inside the
 * platform's function timeout. Running past the limit gets the process killed
 * mid-job, which costs a full lease timeout before that job is retried — so the
 * loop stops claiming well before the ceiling rather than being cut off.
 */
export async function runJobs(options: {
  workerId?: string
  batchSize?: number
  budgetMs?: number
} = {}): Promise<RunResult> {
  const workerId = options.workerId ?? `worker-${randomUUID().slice(0, 8)}`
  const batchSize = options.batchSize ?? 20
  const budgetMs = options.budgetMs ?? 45_000

  const supabase = getSupabaseAdmin()
  const startedAt = Date.now()
  const result: RunResult = { claimed: 0, succeeded: 0, retried: 0, dead: 0 }

  while (Date.now() - startedAt < budgetMs) {
    const { data, error } = await supabase.rpc('claim_jobs', {
      p_worker: workerId,
      p_limit: batchSize,
      p_lease_seconds: 300,
    })

    if (error) {
      console.error('[jobs] claim failed:', error.message)
      break
    }

    const batch = (data ?? []) as JobRecord[]
    if (batch.length === 0) break

    result.claimed += batch.length

    for (const job of batch) {
      // Re-check the budget per job: one slow job shouldn't drag the whole
      // batch past the function timeout.
      if (Date.now() - startedAt >= budgetMs) {
        // Release the claim so the job is retried promptly rather than waiting
        // out a full lease.
        await supabase.rpc('fail_job', {
          p_id: job.id,
          p_error: 'Worker budget exhausted before this job ran',
          p_retryable: true,
          p_backoff_seconds: 0,
        })
        result.retried++
        continue
      }

      const handler = handlers.get(job.kind)
      if (!handler) {
        // An unknown kind will never become known by retrying.
        await supabase.rpc('fail_job', {
          p_id: job.id,
          p_error: `No handler registered for job kind "${job.kind}"`,
          p_retryable: false,
        })
        result.dead++
        continue
      }

      try {
        await handler(job)
        await supabase.rpc('complete_job', { p_id: job.id })
        result.succeeded++
      } catch (err) {
        const permanent = err instanceof PermanentJobError
        const message = err instanceof Error ? err.message : String(err)

        const { data: status } = await supabase.rpc('fail_job', {
          p_id: job.id,
          p_error: message,
          p_retryable: !permanent,
        })

        if (status === 'dead') {
          result.dead++
          console.error(
            `[jobs] ${job.kind} ${job.id} DEAD after ${job.attempts} attempt(s): ${message}`
          )
        } else {
          result.retried++
          console.warn(`[jobs] ${job.kind} ${job.id} failed, will retry: ${message}`)
        }
      }
    }
  }

  return result
}

/**
 * Classifies an HTTP status for retry purposes.
 *
 * 4xx means the request itself is wrong and will be just as wrong next time —
 * retrying a 404 five times only delays the inevitable while consuming the
 * customer's rate limits. 408 and 429 are the exceptions: both explicitly
 * invite a retry.
 */
export function isRetryableStatus(status: number): boolean {
  if (status === 408 || status === 429) return true
  return status >= 500
}
