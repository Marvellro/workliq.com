import { NextResponse } from 'next/server'
import {
  getSupabaseAnon,
  SESSION_COOKIE_OPTIONS,
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from '@/lib/config'
import { isAdminEmail } from '@/lib/admin'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { recordAudit, clientIp, userAgent } from '@/lib/audit'

// Admin sign-in.
//
// This route previously set an `admin-email` cookie to whatever address had
// just verified an OTP, and proxy.ts compared that cookie against a hardcoded
// allowlist. Two problems with that design:
//
//   1. The cookie was the *only* evidence of admin status, and nothing outside
//      proxy.ts checked it — which is why /api/admin/invite was wide open.
//   2. The allowlist lived in source, so revoking an admin required a deploy.
//
// Admin sign-in now issues the same signed Supabase session as a customer
// login, and authority comes from the `admins` table checked server-side on
// every privileged request (lib/admin.ts). There is no longer an `admin-email`
// cookie; the one set by older sessions is cleared below so no stale value
// lingers in a browser.

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { email, otp } = body as { email?: unknown; otp?: unknown }
  if (typeof email !== 'string' || !email || typeof otp !== 'string' || !otp) {
    return NextResponse.json({ error: 'Missing email or code' }, { status: 400 })
  }

  const normalizedEmail = email.trim().toLowerCase()
  const ip = clientIp(req)

  const [emailLimit, ipLimit] = await Promise.all([
    checkRateLimit(`otp:email:${normalizedEmail}`, RATE_LIMITS.otpVerify),
    checkRateLimit(`otp:ip:${ip ?? 'unknown'}`, RATE_LIMITS.otpVerify),
  ])
  if (!emailLimit.allowed || !ipLimit.allowed) {
    return rateLimitResponse(emailLimit.allowed ? ipLimit : emailLimit)
  }

  const { data, error } = await getSupabaseAnon().auth.verifyOtp({
    email: normalizedEmail,
    token: otp,
    type: 'email',
  })

  if (error || !data.session || !data.user) {
    await recordAudit({
      action: 'customer.login_failed',
      actor: normalizedEmail,
      metadata: { surface: 'admin', reason: error?.message ?? 'no session' },
      ip,
      userAgent: userAgent(req),
    })
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 })
  }

  // A valid OTP proves control of the mailbox, not admin rights.
  if (!(await isAdminEmail(normalizedEmail))) {
    await recordAudit({
      action: 'admin.access_denied',
      customerId: data.user.id,
      actor: normalizedEmail,
      metadata: { surface: 'admin_login' },
      ip,
      userAgent: userAgent(req),
    })
    // Same generic message as a bad code: a distinct "not an admin" response
    // would let anyone enumerate which addresses hold admin rights.
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 })
  }

  await recordAudit({
    action: 'customer.login',
    customerId: data.user.id,
    actor: normalizedEmail,
    metadata: { surface: 'admin' },
    ip,
    userAgent: userAgent(req),
  })

  const response = NextResponse.json({ success: true })
  response.cookies.set(ACCESS_TOKEN_COOKIE, data.session.access_token, SESSION_COOKIE_OPTIONS)
  response.cookies.set(REFRESH_TOKEN_COOKIE, data.session.refresh_token, SESSION_COOKIE_OPTIONS)
  // Clear the legacy cookie from any browser that still carries one.
  response.cookies.set('admin-email', '', { maxAge: 0, path: '/' })
  return response
}
