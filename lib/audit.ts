import { getSupabaseAdmin } from './config'

// Append-only audit trail for security-relevant events.
//
// Two reasons this exists beyond compliance paperwork: when a customer asks
// "who connected this HubSpot account and when", there needs to be an answer;
// and if a credential is ever suspected compromised, the blast radius can only
// be established from a record of what was done with it.

export type AuditAction =
  | 'customer.login'
  | 'customer.logout'
  | 'customer.login_failed'
  | 'connection.created'
  | 'connection.failed'
  | 'workflow.created'
  | 'workflow.enabled'
  | 'workflow.disabled'
  | 'workflow.deleted'
  | 'admin.invite_sent'
  | 'admin.waitlist_updated'
  | 'admin.waitlist_deleted'
  | 'admin.access_denied'
  | 'ratelimit.exceeded'

export type AuditEntry = {
  action: AuditAction
  customerId?: string | null
  /** The acting identity when it isn't a customer (e.g. an admin's email). */
  actor?: string | null
  /** Free-form, MUST NOT contain tokens, secrets, or webhook URLs. */
  metadata?: Record<string, unknown>
  ip?: string | null
  userAgent?: string | null
}

/**
 * Records an audit event.
 *
 * Never throws. An audit write failing must not break the user-facing action
 * it describes — a customer should not be unable to log in because the audit
 * table is briefly unavailable. Failures are logged for alerting instead.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const { error } = await getSupabaseAdmin().from('audit_log').insert({
      action: entry.action,
      customer_id: entry.customerId ?? null,
      actor: entry.actor ?? null,
      metadata: entry.metadata ?? {},
      ip: entry.ip ?? null,
      user_agent: entry.userAgent?.slice(0, 500) ?? null,
    })
    if (error) {
      console.error('[audit] insert failed:', entry.action, error.message)
    }
  } catch (err) {
    console.error('[audit] insert threw:', entry.action, err)
  }
}

/**
 * Extracts the client IP from a request.
 *
 * On Vercel `x-forwarded-for` is set by the platform edge, and the left-most
 * entry is the real client. Do not trust this header in an unproxied
 * deployment — there it is attacker-controlled and only useful as a hint.
 */
export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return req.headers.get('x-real-ip')
}

export function userAgent(req: Request): string | null {
  return req.headers.get('user-agent')
}
