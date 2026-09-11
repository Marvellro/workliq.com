import { NextResponse } from 'next/server'
import {
  getSupabaseAnon,
  getSupabaseAdmin,
  SESSION_COOKIE_OPTIONS,
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from '@/lib/config'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { recordAudit, clientIp, userAgent } from '@/lib/audit'
import { getEntitlements, syncAiBudgetToPlan } from '@/lib/plans'

// Exchanges an emailed OTP for a session.
//
// Cookie lifetime is 7 days. Supabase access tokens expire much sooner (1 hour
// by default), but lib/session.ts refreshes them and writes the rotated pair
// back, so the cookie lifetime is the real session length.

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { email, otp } = body as { email?: unknown; otp?: unknown }

  if (typeof email !== 'string' || !email || typeof otp !== 'string' || !otp) {
    return NextResponse.json({ error: 'Missing email or code' }, { status: 400 })
  }

  const normalizedEmail = email.trim().toLowerCase()

  // A 6-digit OTP is only a million possibilities — without a cap, an attacker
  // who knows a customer's email address can simply enumerate them. Limit by
  // email AND by IP: by email alone, an attacker could lock a victim out by
  // exhausting their quota; by IP alone, a distributed attempt slips through.
  const ip = clientIp(req)
  const [emailLimit, ipLimit] = await Promise.all([
    checkRateLimit(`otp:email:${normalizedEmail}`, RATE_LIMITS.otpVerify),
    checkRateLimit(`otp:ip:${ip ?? 'unknown'}`, RATE_LIMITS.otpVerify),
  ])

  if (!emailLimit.allowed || !ipLimit.allowed) {
    await recordAudit({
      action: 'ratelimit.exceeded',
      actor: normalizedEmail,
      metadata: { endpoint: 'auth/customer/verify' },
      ip,
      userAgent: userAgent(req),
    })
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
      metadata: { reason: error?.message ?? 'no session returned' },
      ip,
      userAgent: userAgent(req),
    })
    // Deliberately generic: echoing Supabase's message back distinguishes
    // "no such user" from "wrong code", which confirms to an attacker whether
    // an address is registered.
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 })
  }

  // Ensure a customers row exists for this user. Uses service role so it can
  // write regardless of RLS. onConflict: 'id' makes re-logins idempotent.
  const { error: customerError } = await getSupabaseAdmin()
    .from('customers')
    .upsert({ id: data.user.id, email: data.user.email }, { onConflict: 'id' })

  if (customerError) {
    // Don't block login over this — the row may already exist. Log and continue.
    console.error('Failed to upsert customer row:', customerError)
  }

  // Link any subscription bought under this email to the account.
  //
  // Checkout happens before sign-up, so the very first billing webhook arrives
  // with no customer row to attach to. This is where the two finally meet —
  // without it, someone pays and then sits on the free plan, which is the worst
  // bug a billing system can have.
  const { error: claimError } = await getSupabaseAdmin().rpc(
    'claim_subscription_for_customer',
    { p_customer_id: data.user.id, p_email: normalizedEmail }
  )
  if (claimError) {
    console.error('Failed to claim subscription for customer:', claimError.message)
  } else {
    // Bring the AI budget in line with whatever they are actually paying for.
    const entitlements = await getEntitlements(data.user.id)
    await syncAiBudgetToPlan(data.user.id, entitlements.plan)
  }

  await recordAudit({
    action: 'customer.login',
    customerId: data.user.id,
    actor: data.user.email,
    ip,
    userAgent: userAgent(req),
  })

  const response = NextResponse.json({ success: true })
  response.cookies.set(ACCESS_TOKEN_COOKIE, data.session.access_token, SESSION_COOKIE_OPTIONS)
  response.cookies.set(REFRESH_TOKEN_COOKIE, data.session.refresh_token, SESSION_COOKIE_OPTIONS)
  return response
}
