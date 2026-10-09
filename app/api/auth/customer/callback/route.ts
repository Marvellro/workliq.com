import { NextResponse } from 'next/server'
import {
  SESSION_COOKIE_OPTIONS,
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from '@/lib/config'
import { verifyAccessToken } from '@/lib/session'
import { establishCustomerSession } from '@/lib/customer-session'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { recordAudit, clientIp, userAgent } from '@/lib/audit'

// Turns the tokens from an emailed sign-in link into a real session.
//
// Supabase returns them in the URL fragment, which never reaches a server — so
// the page reads them in the browser and posts them here, and this is the only
// place that turns them into the HTTP-only cookies the application actually
// authenticates against.
//
// The token is verified before anything is written. The fragment arrives from
// the browser like any other request body, so "Supabase put it there" is not
// something this endpoint can know: it checks the signature against the
// project's published keys, exactly as every other request does.

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const ip = clientIp(req)

  // An auth endpoint that mints cookies, so it is capped like the OTP path.
  const limit = await checkRateLimit(`callback:ip:${ip ?? 'unknown'}`, RATE_LIMITS.otpVerify)
  if (!limit.allowed) {
    await recordAudit({
      action: 'ratelimit.exceeded',
      metadata: { endpoint: 'auth/customer/callback' },
      ip,
      userAgent: userAgent(req),
    })
    return rateLimitResponse(limit)
  }

  const body = await req.json().catch(() => null)
  const accessToken = body?.access_token
  const refreshToken = body?.refresh_token

  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
    return NextResponse.json({ error: 'Missing sign-in tokens' }, { status: 400 })
  }

  let session
  try {
    session = await verifyAccessToken(accessToken)
  } catch {
    session = null
  }

  if (!session) {
    await recordAudit({
      action: 'customer.login_failed',
      metadata: { reason: 'link token failed verification' },
      ip,
      userAgent: userAgent(req),
    })
    // Generic, like the OTP path: distinguishing "expired" from "forged" tells
    // an attacker which of the two they achieved.
    return NextResponse.json({ error: 'This sign-in link is no longer valid.' }, { status: 401 })
  }

  await establishCustomerSession({
    userId: session.customerId,
    email: session.email,
    ip,
    userAgent: userAgent(req),
  })

  const response = NextResponse.json({ success: true })
  response.cookies.set(ACCESS_TOKEN_COOKIE, accessToken, SESSION_COOKIE_OPTIONS)
  response.cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, SESSION_COOKIE_OPTIONS)
  return response
}
