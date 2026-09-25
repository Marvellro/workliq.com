import { Resend } from 'resend'
import { getSupabaseAdmin, appUrl } from './config'
import { providerLabel, type ConnectionProvider } from './connection-health'

// The digest: the one place Workliq tells a customer something has gone wrong
// without being asked.
//
// Everything before this was pull. The activity feed is good, but it only helps
// someone who already suspects a problem — and the whole promise of the product
// is that you don't have to watch it. A customer whose HubSpot grant died found
// out weeks later, by noticing an alert that never arrived.
//
// Two things go in one email rather than two:
//
//   broken connections — needs action, and nothing works until it is taken
//   dead jobs          — automations that already silently did not happen
//
// One message, because they usually share a cause. A dead grant produces both,
// and two separate emails about one problem reads like a system that doesn't
// understand its own state.

const FROM = 'Workliq <hello@workliq.com>'

// How many dead jobs to name individually before summarising the rest. A digest
// that lists forty failures is not a digest.
const MAX_LISTED_JOBS = 5

export type BrokenConnection = {
  provider: ConnectionProvider
  message: string
  brokenAt: string | null
}

export type DeadJob = {
  id: string
  kind: string
  workflowName: string | null
  createdAt: string
}

export type CustomerDigest = {
  customerId: string
  email: string
  connections: BrokenConnection[]
  deadJobs: DeadJob[]
}

const CONNECTION_TABLES: Record<ConnectionProvider, string> = {
  hubspot: 'hubspot_connections',
  slack: 'slack_connections',
  notion: 'notion_connections',
}

export type SweepResult = {
  customersNotified: number
  connectionsReported: number
  jobsReported: number
  failures: number
}

/**
 * Finds everything unreported, sends one digest per affected customer, and
 * stamps what it sent.
 *
 * Safe to call often and from several places at once — the work it finds is
 * defined by the unstamped rows, so a sweep with nothing to report does three
 * cheap partial-index lookups and returns.
 *
 * Nothing is stamped unless its email was accepted. A Resend outage therefore
 * costs a delay, never a lost notification: the next sweep finds the same rows
 * still unstamped and tries again.
 */
export async function runNotificationSweep(): Promise<SweepResult> {
  const result: SweepResult = {
    customersNotified: 0,
    connectionsReported: 0,
    jobsReported: 0,
    failures: 0,
  }

  if (!process.env.RESEND_API_KEY) {
    // Deliberately not an error. Local development and preview deployments run
    // without a mail key, and a sweep that throws there would take the job
    // drain down with it.
    console.warn('[notify] RESEND_API_KEY is not set — skipping digest sweep')
    return result
  }

  const supabase = getSupabaseAdmin()
  const digests = new Map<string, CustomerDigest>()

  function digestFor(customerId: string): CustomerDigest {
    let d = digests.get(customerId)
    if (!d) {
      d = { customerId, email: '', connections: [], deadJobs: [] }
      digests.set(customerId, d)
    }
    return d
  }

  // ── Broken connections ─────────────────────────────────────────────────────
  for (const provider of Object.keys(CONNECTION_TABLES) as ConnectionProvider[]) {
    const { data, error } = await supabase
      .from(CONNECTION_TABLES[provider])
      .select('customer_id, last_error, last_error_at')
      .eq('status', 'needs_reauth')
      .is('broken_notified_at', null)

    if (error) {
      console.error(`[notify] could not read broken ${provider} connections:`, error.message)
      result.failures++
      continue
    }

    for (const row of data ?? []) {
      digestFor(row.customer_id).connections.push({
        provider,
        message: row.last_error ?? `Your ${providerLabel(provider)} connection needs reconnecting.`,
        brokenAt: row.last_error_at,
      })
    }
  }

  // ── Dead jobs ──────────────────────────────────────────────────────────────
  const { data: deadJobs, error: jobsError } = await supabase
    .from('jobs')
    .select('id, customer_id, kind, payload, created_at')
    .eq('status', 'dead')
    .is('notified_at', null)
    // Jobs with no customer (housekeeping) have nobody to tell.
    .not('customer_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(500)

  if (jobsError) {
    console.error('[notify] could not read dead jobs:', jobsError.message)
    result.failures++
  }

  // Name the workflow rather than the job kind. "Deal stage change didn't run"
  // is something a customer can act on; "workflow.action failed" is not.
  const workflowIds = Array.from(
    new Set(
      (deadJobs ?? [])
        .map((j) => (j.payload as { workflowId?: string } | null)?.workflowId)
        .filter((id): id is string => typeof id === 'string')
    )
  )

  const workflowNames = new Map<string, string>()
  if (workflowIds.length > 0) {
    const { data: rows } = await supabase
      .from('workflows')
      .select('id, name')
      .in('id', workflowIds)
    for (const row of rows ?? []) workflowNames.set(row.id, row.name)
  }

  for (const job of deadJobs ?? []) {
    const workflowId = (job.payload as { workflowId?: string } | null)?.workflowId
    digestFor(job.customer_id as string).deadJobs.push({
      id: job.id,
      kind: job.kind,
      workflowName: workflowId ? workflowNames.get(workflowId) ?? null : null,
      createdAt: job.created_at,
    })
  }

  if (digests.size === 0) return result

  // ── Recipients ─────────────────────────────────────────────────────────────
  const { data: customers, error: customerError } = await supabase
    .from('customers')
    .select('id, email')
    .in('id', Array.from(digests.keys()))

  if (customerError) {
    console.error('[notify] could not read customer emails:', customerError.message)
    return { ...result, failures: result.failures + 1 }
  }

  for (const row of customers ?? []) {
    const d = digests.get(row.id)
    if (d) d.email = row.email
  }

  // ── Send ───────────────────────────────────────────────────────────────────
  const resend = new Resend(process.env.RESEND_API_KEY)

  for (const digest of digests.values()) {
    if (!digest.email) {
      // A connection whose customer row has gone is a data problem, not a
      // notification problem — and there is nowhere to send it.
      console.error(`[notify] no email for customer ${digest.customerId} — skipping digest`)
      result.failures++
      continue
    }

    try {
      const { subject, html, text } = buildDigestEmail(digest)
      await resend.emails.send({ from: FROM, to: digest.email, subject, html, text })
    } catch (err) {
      // Left unstamped on purpose: the next sweep retries it.
      console.error(`[notify] digest to ${digest.customerId} failed:`, err)
      result.failures++
      continue
    }

    // Stamp only what was actually in the email that just went out.
    const now = new Date().toISOString()

    for (const conn of digest.connections) {
      const { error } = await supabase
        .from(CONNECTION_TABLES[conn.provider])
        .update({ broken_notified_at: now })
        .eq('customer_id', digest.customerId)
        .is('broken_notified_at', null)

      if (error) {
        // The customer has been told; failing to record that risks telling them
        // again, which is the better of the two failure modes.
        console.error(`[notify] could not stamp ${conn.provider} connection:`, error.message)
      }
    }

    if (digest.deadJobs.length > 0) {
      const { error } = await supabase
        .from('jobs')
        .update({ notified_at: now })
        .in('id', digest.deadJobs.map((j) => j.id))

      if (error) console.error('[notify] could not stamp dead jobs:', error.message)
    }

    result.customersNotified++
    result.connectionsReported += digest.connections.length
    result.jobsReported += digest.deadJobs.length
  }

  return result
}

// ── Rendering ────────────────────────────────────────────────────────────────

/**
 * Builds the whole email. Pure — takes a digest, returns strings, touches
 * nothing else — so what a customer actually receives can be asserted directly
 * instead of inferred from a mock.
 */
export function buildDigestEmail(d: CustomerDigest): {
  subject: string
  html: string
  text: string
} {
  return { subject: subjectFor(d), html: renderHtml(d), text: renderText(d) }
}

function subjectFor(d: CustomerDigest): string {
  // Lead with the connection when there is one: it is the cause, it is the
  // thing only the customer can fix, and naming the tool makes the email
  // recognisable in a crowded inbox.
  if (d.connections.length === 1) {
    return `Action needed: your ${providerLabel(d.connections[0].provider)} connection stopped working`
  }
  if (d.connections.length > 1) {
    return `Action needed: ${d.connections.length} Workliq connections stopped working`
  }
  const n = d.deadJobs.length
  return n === 1 ? '1 Workliq automation did not run' : `${n} Workliq automations did not run`
}

function jobLabel(job: DeadJob): string {
  if (job.workflowName) return job.workflowName
  if (job.kind === 'hubspot.event') return 'A HubSpot event'
  if (job.kind === 'stripe.event') return 'A billing update'
  return job.kind
}

function renderText(d: CustomerDigest): string {
  const lines: string[] = []

  if (d.connections.length > 0) {
    lines.push('NEEDS RECONNECTING', '')
    for (const c of d.connections) {
      lines.push(`* ${providerLabel(c.provider)}: ${c.message}`)
    }
    lines.push('', `Reconnect: ${appUrl('/dashboard')}`, '')
  }

  if (d.deadJobs.length > 0) {
    lines.push('AUTOMATIONS THAT DID NOT RUN', '')
    for (const job of d.deadJobs.slice(0, MAX_LISTED_JOBS)) {
      lines.push(`* ${jobLabel(job)} — ${new Date(job.createdAt).toUTCString()}`)
    }
    if (d.deadJobs.length > MAX_LISTED_JOBS) {
      lines.push(`* …and ${d.deadJobs.length - MAX_LISTED_JOBS} more`)
    }
    lines.push('', `Full history: ${appUrl('/dashboard/activity')}`, '')
  }

  lines.push(
    '',
    'You are receiving this because something in your Workliq account needs',
    'attention. We only send this when there is an action to take.'
  )

  return lines.join('\n')
}

function renderHtml(d: CustomerDigest): string {
  const parts: string[] = []

  parts.push(
    `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0D0F1A">`
  )

  if (d.connections.length > 0) {
    parts.push(
      `<h2 style="font-size:17px;font-weight:600;margin:0 0 4px">Needs reconnecting</h2>`,
      `<p style="font-size:14px;color:#6B7280;margin:0 0 16px">Workflows using ${
        d.connections.length === 1 ? 'this connection are' : 'these connections are'
      } paused until you reconnect.</p>`
    )
    for (const c of d.connections) {
      parts.push(
        `<div style="border:1px solid #FECACA;background:#FEF2F2;border-radius:8px;padding:12px 14px;margin-bottom:8px">`,
        `<div style="font-size:14px;font-weight:600;color:#991B1B">${escapeHtml(providerLabel(c.provider))}</div>`,
        `<div style="font-size:13px;color:#7F1D1D;margin-top:3px">${escapeHtml(c.message)}</div>`,
        `</div>`
      )
    }
    parts.push(
      `<p style="margin:16px 0 28px"><a href="${appUrl('/dashboard')}" style="display:inline-block;background:#1A56DB;color:#fff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;padding:10px 18px">Reconnect now</a></p>`
    )
  }

  if (d.deadJobs.length > 0) {
    parts.push(
      `<h2 style="font-size:17px;font-weight:600;margin:0 0 4px">Automations that did not run</h2>`,
      `<p style="font-size:14px;color:#6B7280;margin:0 0 16px">These were retried and did not succeed. You can replay them once the cause is fixed.</p>`,
      `<table style="width:100%;border-collapse:collapse;font-size:13px">`
    )
    for (const job of d.deadJobs.slice(0, MAX_LISTED_JOBS)) {
      parts.push(
        `<tr>`,
        `<td style="padding:7px 0;border-bottom:1px solid #F3F4F6;color:#0D0F1A">${escapeHtml(jobLabel(job))}</td>`,
        `<td style="padding:7px 0;border-bottom:1px solid #F3F4F6;color:#9CA3AF;text-align:right;white-space:nowrap">${escapeHtml(
          new Date(job.createdAt).toUTCString()
        )}</td>`,
        `</tr>`
      )
    }
    parts.push(`</table>`)
    if (d.deadJobs.length > MAX_LISTED_JOBS) {
      parts.push(
        `<p style="font-size:13px;color:#6B7280;margin:10px 0 0">…and ${
          d.deadJobs.length - MAX_LISTED_JOBS
        } more.</p>`
      )
    }
    parts.push(
      `<p style="margin:16px 0 28px"><a href="${appUrl('/dashboard/activity')}" style="font-size:14px;color:#1A56DB;text-decoration:none;font-weight:500">View full history →</a></p>`
    )
  }

  parts.push(
    `<p style="font-size:12px;color:#9CA3AF;border-top:1px solid #F3F4F6;padding-top:16px;margin:0">`,
    `You are receiving this because something in your Workliq account needs attention. We only send this when there is an action to take.`,
    `</p>`,
    `</div>`
  )

  return parts.join('')
}

/**
 * Everything interpolated into the HTML is either our own copy or a value that
 * originated in a provider's error response, so it is escaped rather than
 * trusted. Mail clients render HTML, and an unescaped `<` from an API body
 * would at best break the layout.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
