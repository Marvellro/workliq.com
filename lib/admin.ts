import { getSupabaseAdmin } from './config'
import { getCustomerSession, type CustomerSession } from './session'
import { recordAudit } from './audit'

// Server-side admin authorization.
//
// This module exists because `/api/admin/invite` previously had no auth check
// at all: it called `auth.admin.inviteUserByEmail` with the service-role key
// for any unauthenticated caller. `proxy.ts` guarded `/admin/:path*` — page
// routes — but matchers are anchored to the start of the path, so `/api/admin/*`
// was never covered.
//
// The rule this establishes: **proxy.ts is a redirect convenience, never the
// security boundary.** Next's own docs note proxy "is meant to be invoked
// separately of your render code and in optimized cases deployed to your CDN",
// so nothing that matters may depend on it having run. Every privileged route
// authorizes itself, here.

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export type AdminSession = CustomerSession & { isAdmin: true }

/**
 * Returns true if `email` is in the `admins` table.
 *
 * The allowlist lives in the database rather than in code (the old hardcoded
 * ADMIN_EMAILS array in proxy.ts) so that granting or revoking admin access
 * doesn't require a redeploy — revocation in particular should be immediate.
 */
export async function isAdminEmail(email: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from('admins')
    .select('email')
    .eq('email', email.toLowerCase())
    .maybeSingle()

  if (error) {
    // Fail closed: an error here must never be read as "yes".
    console.error('[admin] lookup failed:', error.message)
    return false
  }
  return Boolean(data)
}

/**
 * Requires a valid customer session whose email is an admin. Throws
 * `UnauthorizedError` when not logged in, `ForbiddenError` when logged in
 * without admin rights.
 *
 * Authorization is derived from the signed session JWT and a live database
 * lookup — never from the `admin-email` cookie, which is an unsigned value the
 * server previously trusted on its own.
 */
export async function requireAdmin(req?: Request): Promise<AdminSession> {
  const session = await getCustomerSession()

  if (!session) {
    throw new (await import('./session')).UnauthorizedError()
  }

  if (!(await isAdminEmail(session.email))) {
    await recordAudit({
      action: 'admin.access_denied',
      customerId: session.customerId,
      actor: session.email,
      metadata: { path: req ? new URL(req.url).pathname : undefined },
    })
    throw new ForbiddenError()
  }

  return { ...session, isAdmin: true }
}

/** Maps an auth error thrown by `requireAdmin` to the right HTTP response. */
export function authErrorResponse(err: unknown): Response | null {
  if (err instanceof ForbiddenError) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (err instanceof Error && err.name === 'UnauthorizedError') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
