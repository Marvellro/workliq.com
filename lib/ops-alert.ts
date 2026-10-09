import { Resend } from 'resend'
import { getSupabaseAdmin, appUrl } from './config'

// Operator alerting.
//
// The customer digest tells a customer what they can fix. This tells the
// operator what only they can fix — and deliberately not the same list. A
// broken HubSpot grant is already the customer's email; sending it here too
// just trains someone to ignore both.
//
// What qualifies is a condition the customer's own digest will not surface,
// or will not surface in time:
//
//   the queue has stopped draining     nobody gets anything, including digests
//   webhooks are being rejected        the customer sees silence, not an error
//   connections breaking across        one account is their problem; several
//   several accounts at once           at once is ours
//   jobs are dying                     the customer is told, but the rate is
//                                      the operator's business
//
// Deliberately not alerted on: a single broken connection, workflows paused by
// a plan change, AI budgets being reached. Each is working as designed and the
// customer has already been told.

const FROM = 'Workliq <hello@workliq.com>'

/**
 * How long a condition stays quiet after being reported.
 *
 * A stalled queue on Monday should not mail again every time a webhook arrives
 * on Tuesday. A day is long enough to stop the noise and short enough that a
 * problem nobody fixed is raised again.
 */
const COOLDOWN_HOURS = 24

/** A queued job this far past its run time means nothing is draining. */
const OVERDUE_HOURS = 6

export type Severity = 'critical' | 'warning'

export type OperatorSignal = {
  /** Stable per condition, not per occurrence — the cooldown keys on it. */
  key: string
  severity: Severity
  headline: string
  detail: string
}

export type OpsAlertResult = {
  /**
   * Whether alerting is switched on at all.
   *
   * Without this, an unconfigured deployment and a perfectly healthy one both
   * report zeros — a silent no-op that reads as health, which is the exact
   * failure this module exists to prevent. Saying so costs one boolean.
   */
  configured: boolean
  found: number
  sent: number
  suppressed: number
}

// ── Collection ───────────────────────────────────────────────────────────────

/**
 * Looks for conditions worth an operator's attention.
 *
 * Pure-ish: reads, decides, returns. Sending and cooldown are separate so the
 * judgement about what counts as a problem can be read on its own.
 */
export async function countOverdueJobs(): Promise<number> {
  const { count } = await getSupabaseAdmin()
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .lt('run_after', new Date(Date.now() - OVERDUE_HOURS * 3600_000).toISOString())

  return count ?? 0
}

/**
 * @param overdueJobs how many jobs were overdue when this invocation began.
 *
 * Measured by the caller, before it drains the queue, and that ordering is the
 * whole point. Every entry point runs the drain immediately before alerting, so
 * a count taken here would have already had the claimable jobs removed from it
 * — the signal would only ever fire for a backlog too large for one drain to
 * clear, while claiming that nothing was running. It would never detect the
 * thing it is named after.
 *
 * Omitted, it is measured here, which under-reports rather than invents. That
 * is the safe direction for a check whose false positives would train someone
 * to ignore it.
 */
export async function collectOperatorSignals(
  overdueJobs?: number
): Promise<OperatorSignal[]> {
  const supabase = getSupabaseAdmin()
  const signals: OperatorSignal[] = []

  // ── The queue has stopped draining ─────────────────────────────────────────
  // The most serious thing on this list, because it is silent in both
  // directions: no workflow fires, and no digest goes out to say so, since the
  // sweep runs in the same place the drain does.
  const overdue = overdueJobs ?? (await countOverdueJobs())

  if (overdue > 0) {
    signals.push({
      key: 'queue_stalled',
      severity: 'critical',
      headline:
        overdue === 1
          ? `1 job was overdue by more than ${OVERDUE_HOURS} hours`
          : `${overdue} jobs were overdue by more than ${OVERDUE_HOURS} hours`,
      detail:
        'Work had been queued that long without running, measured before this invocation drained anything — so earlier runs were not clearing it. Customers get no automations and no digest either, because the sweep runs in the same invocation as the drain. Check that the cron is firing and that the worker is not erroring on claim.',
    })
  }

  // ── Webhooks being turned away ─────────────────────────────────────────────
  // From the customer's side this is indistinguishable from nothing happening.
  const since = new Date(Date.now() - 24 * 3600_000).toISOString()
  const { count: rejections } = await supabase
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('action', 'webhook.rejected')
    .gte('created_at', since)

  if (rejections && rejections > 0) {
    signals.push({
      key: 'webhook_rejections',
      severity: 'warning',
      headline: `${rejections} webhook${rejections === 1 ? '' : 's'} rejected in the last 24 hours`,
      detail:
        'Signature verification failed. A rotated signing secret, a subscription pointing at the wrong host, or someone probing the endpoint. The audit entries carry the reason and the URI that was verified against.',
    })
  }

  // ── Connections breaking across several accounts ───────────────────────────
  // One account losing a credential is that account's problem, and they have
  // already had an email about it. Several at once is a configuration problem
  // at this end, and nobody is going to tell us.
  const broken = await Promise.all(
    (['hubspot_connections', 'slack_connections', 'notion_connections'] as const).map((table) =>
      supabase.from(table).select('customer_id').eq('status', 'needs_reauth')
    )
  )

  const affected = new Set<string>()
  for (const result of broken) {
    for (const row of result.data ?? []) affected.add(row.customer_id as string)
  }

  if (affected.size > 1) {
    signals.push({
      key: 'connections_broken_widely',
      severity: 'critical',
      headline: `${affected.size} accounts have a broken connection`,
      detail:
        'More than one account losing a credential at the same time usually means something at this end — a rotated client secret, a changed redirect URI, an app uninstalled from a shared install. Worth checking before asking customers to reconnect.',
    })
  }

  // ── Jobs that gave up ──────────────────────────────────────────────────────
  const { count: dead } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'dead')

  if (dead && dead > 0) {
    signals.push({
      key: 'dead_jobs',
      severity: 'warning',
      headline:
        dead === 1 ? '1 job exhausted its retries' : `${dead} jobs exhausted their retries`,
      detail:
        'Customers are told about their own, so this is about the rate rather than any one of them. A cluster usually points at one cause rather than many.',
    })
  }

  return signals
}

// ── Sending ──────────────────────────────────────────────────────────────────

/**
 * Reports anything new to the operator.
 *
 * Never throws. It runs inside the same `after()` drain the queue uses, and an
 * alerting failure must not take delivery down with it — that would be the
 * monitoring causing the outage.
 */
export async function runOperatorAlert(overdueJobs?: number): Promise<OpsAlertResult> {
  const result: OpsAlertResult = { configured: false, found: 0, sent: 0, suppressed: 0 }

  const to = process.env.OPS_ALERT_EMAIL
  if (!to || !process.env.RESEND_API_KEY) {
    // Not an error — preview deployments and local development run without
    // either, and throwing here would take the drain down with it. But it is
    // said out loud, because nobody notices monitoring that was never on.
    console.warn(
      '[ops-alert] OPS_ALERT_EMAIL or RESEND_API_KEY is not set — operator alerting is off'
    )
    return result
  }

  result.configured = true

  try {
    const supabase = getSupabaseAdmin()
    const signals = await collectOperatorSignals(overdueJobs)
    result.found = signals.length
    if (signals.length === 0) return result

    const cutoff = new Date(Date.now() - COOLDOWN_HOURS * 3600_000).toISOString()
    const { data: recent } = await supabase
      .from('ops_alerts')
      .select('signal')
      .gte('created_at', cutoff)

    const alreadyTold = new Set((recent ?? []).map((row) => row.signal as string))
    const fresh = signals.filter((s) => !alreadyTold.has(s.key))
    result.suppressed = signals.length - fresh.length

    if (fresh.length === 0) return result

    const { subject, html, text } = buildOperatorEmail(fresh)

    await new Resend(process.env.RESEND_API_KEY).emails.send({ from: FROM, to, subject, html, text })

    // Recorded only after the send is accepted, so a mail failure means the
    // condition is reported on the next sweep rather than swallowed.
    await supabase
      .from('ops_alerts')
      .insert(fresh.map((s) => ({ signal: s.key, details: { headline: s.headline } })))

    result.sent = fresh.length
    return result
  } catch (err) {
    console.error('[ops-alert] failed:', err)
    return result
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** Pure, so what an operator actually receives can be asserted directly. */
export function buildOperatorEmail(signals: OperatorSignal[]): {
  subject: string
  html: string
  text: string
} {
  const critical = signals.filter((s) => s.severity === 'critical')

  // The subject names the worst thing, because that is what decides whether
  // someone opens it now or after dinner.
  const subject =
    critical.length > 0
      ? `[Workliq] ${critical[0].headline}`
      : `[Workliq] ${signals[0].headline}`

  const text = [
    ...signals.flatMap((s) => [`${s.severity.toUpperCase()}: ${s.headline}`, s.detail, '']),
    `Activity: ${appUrl('/dashboard/activity')}`,
    '',
    'Sent because a condition appeared that customers cannot fix themselves.',
    `Each condition is reported once per ${COOLDOWN_HOURS} hours.`,
  ].join('\n')

  const html = [
    `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0D0F1A">`,
    ...signals.map((s) => {
      const isCritical = s.severity === 'critical'
      return [
        `<div style="border:1px solid ${isCritical ? '#FECACA' : '#FDE68A'};background:${isCritical ? '#FEF2F2' : '#FFFBEB'};border-radius:8px;padding:12px 14px;margin-bottom:10px">`,
        `<div style="font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:${isCritical ? '#991B1B' : '#92400E'}">${s.severity}</div>`,
        `<div style="font-size:15px;font-weight:600;margin-top:4px">${escapeHtml(s.headline)}</div>`,
        `<div style="font-size:13px;color:#374151;margin-top:6px;line-height:1.5">${escapeHtml(s.detail)}</div>`,
        `</div>`,
      ].join('')
    }),
    `<p style="margin:16px 0 0"><a href="${appUrl('/dashboard/activity')}" style="font-size:14px;color:#1A56DB;text-decoration:none;font-weight:500">Activity →</a></p>`,
    `<p style="font-size:12px;color:#9CA3AF;border-top:1px solid #F3F4F6;padding-top:16px;margin:20px 0 0">`,
    `Sent because a condition appeared that customers cannot fix themselves. Each condition is reported once per ${COOLDOWN_HOURS} hours.`,
    `</p>`,
    `</div>`,
  ].join('')

  return { subject, html, text }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
