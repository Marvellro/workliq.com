// The dead-man's switch for the queue worker.
//
// Every other alert in this system runs inside the thing it reports on. The
// operator alert (lib/ops-alert.ts) is called from /api/cron/jobs, so when that
// endpoint is down, unauthorised or failing, the alert goes down with it. And
// pg_cron, which calls the endpoint every minute (021_queue_pinger.sql), tells
// nobody when a call fails. The likeliest way for that to happen is mundane:
// CRON_SECRET rotated in Vercel but not in Vault, and every call answered 401.
//
// So the signal is inverted. A healthy run pings an outside service, and when
// the pings stop, that service raises the alarm. Because silence is the alert,
// it catches the failures nobody anticipated as well as the ones listed here:
// the endpoint down, a 401, a 500, the database unreachable, pg_cron stopped.
//
// ── What "healthy" has to mean ───────────────────────────────────────────────
// Reaching the end of the handler is not enough. When the database was
// unreachable, the drain logged the error and returned claimed: 0 — identical
// to an empty queue — and the route answered 200. A heartbeat sent on that
// would have reported the system alive through exactly the outage it exists to
// catch. The caller derives `healthy` from RunResult.claimFailed.
//
// ── What the ping carries: nothing ──────────────────────────────────────────
// A bare GET with no body and no headers of its own. The service learns that a
// run succeeded, and when — nothing about any customer. That is a requirement,
// not tidiness: section 5.1 of the privacy policy lists the vendors that
// receive customer information and says "This list is complete". It stays true
// only while this request carries no customer data. Do not add the run summary
// here without amending that policy first.
//
// ── The URL is a capability ─────────────────────────────────────────────────
// Anyone holding it can send "alive" pings and mask a real outage. It lives in
// WORKER_HEARTBEAT_URL, set for Production only — a preview deployment pinging
// the production check would hide a production failure — and it is never
// logged.

export type HeartbeatOutcome =
  | 'sent'          // the service acknowledged the ping
  | 'unconfigured'  // no URL set: the switch is not armed, and the response says so
  | 'misconfigured' // a URL is set but is not https, so it was refused rather than sent
  | 'withheld'      // the run was not healthy, so no ping — the silence is the alarm
  | 'failed'        // a ping was attempted and did not succeed

const DEFAULT_TIMEOUT_MS = 5_000

export async function sendHeartbeat(options: {
  healthy: boolean
  /** Defaults to WORKER_HEARTBEAT_URL. Passed explicitly by tests. */
  url?: string | null
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<HeartbeatOutcome> {
  const raw = options.url !== undefined ? options.url : process.env.WORKER_HEARTBEAT_URL
  const url = (raw ?? '').trim()

  // Checked before health, deliberately. Whether the switch is armed at all is
  // the more important fact: an unarmed switch reported as "withheld" during an
  // outage would read as working-as-designed.
  if (!url) return 'unconfigured'

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    console.error('[heartbeat] WORKER_HEARTBEAT_URL is not a valid URL — heartbeat not sent')
    return 'misconfigured'
  }
  if (parsed.protocol !== 'https:') {
    console.error('[heartbeat] WORKER_HEARTBEAT_URL must be https — heartbeat not sent')
    return 'misconfigured'
  }

  if (!options.healthy) return 'withheld'

  const fetchImpl = options.fetchImpl ?? fetch
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      cache: 'no-store',
      // The worker is waiting on this. A monitoring service that hangs must
      // not hold the drain's invocation open toward its time limit.
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
    if (res.ok) return 'sent'
    console.warn(`[heartbeat] ping answered ${res.status}`)
    return 'failed'
  } catch (err) {
    console.warn('[heartbeat] ping failed:', err instanceof Error ? err.name : 'unknown error')
    return 'failed'
  }
}
