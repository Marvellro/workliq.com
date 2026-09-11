import { getSupabaseAdmin } from './config'

// Fixed-window rate limiting backed by Postgres.
//
// Deliberately not Redis/Upstash: that is another vendor, another secret to
// rotate, and another dependency that can take the login path down. At current
// volume a single indexed Postgres upsert per guarded request is not the
// bottleneck. If write volume ever makes it one, the interface here stays the
// same and only the backend changes.
//
// The counter is incremented inside one SQL statement (see the
// `check_rate_limit` function in 007_audit_and_rate_limits.sql) so two
// concurrent requests cannot both read the same count and both decide they are
// under the limit.

export type RateLimitRule = {
  /** Window length in seconds. */
  windowSeconds: number
  /** Maximum requests permitted per key per window. */
  max: number
}

// Chosen to stop automated abuse without tripping a real person:
export const RATE_LIMITS = {
  // 10 codes per 15 min per email. A 6-digit OTP has a million values, so
  // capping attempts is the entire defence against simply guessing it.
  otpVerify: { windowSeconds: 900, max: 10 },
  // The waitlist endpoint sends mail via Resend on every call — unthrottled it
  // is an open relay that will get the sending domain blacklisted.
  waitlist: { windowSeconds: 3600, max: 5 },
  // Generous: this only exists to stop a runaway script.
  workflowWrite: { windowSeconds: 60, max: 30 },
  oauthStart: { windowSeconds: 300, max: 20 },
} as const satisfies Record<string, RateLimitRule>

export type RateLimitResult = {
  allowed: boolean
  /** Requests used in the current window, including this one. */
  count: number
  /** Seconds until the current window resets. */
  retryAfter: number
}

/**
 * Consumes one unit against `key` and reports whether the caller is permitted.
 *
 * `key` should be scoped by both purpose and subject, e.g.
 * `otp:user@example.com` or `waitlist:203.0.113.4` — a bare identifier would
 * share a counter across unrelated endpoints.
 *
 * **Fails open.** If Postgres is unreachable the request is allowed and the
 * failure is logged. The alternative — failing closed — turns a database blip
 * into a total login outage for every customer, which is a worse outcome than
 * a brief gap in brute-force protection. Supabase Auth applies its own limits
 * underneath this, so OTP verification is not left completely unguarded.
 */
export async function checkRateLimit(
  key: string,
  rule: RateLimitRule
): Promise<RateLimitResult> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc('check_rate_limit', {
      p_key: key,
      p_window_seconds: rule.windowSeconds,
      p_max: rule.max,
    })

    if (error) {
      console.error('[rate-limit] check failed, allowing request:', key, error.message)
      return { allowed: true, count: 0, retryAfter: 0 }
    }

    const row = Array.isArray(data) ? data[0] : data
    const count = Number(row?.request_count ?? 0)
    const allowed = Boolean(row?.allowed)

    return {
      allowed,
      count,
      retryAfter: allowed ? 0 : Number(row?.retry_after ?? rule.windowSeconds),
    }
  } catch (err) {
    console.error('[rate-limit] check threw, allowing request:', key, err)
    return { allowed: true, count: 0, retryAfter: 0 }
  }
}

/** Standard 429 body + Retry-After header for a blocked request. */
export function rateLimitResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({
      error: 'Too many requests. Please try again shortly.',
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(result.retryAfter),
      },
    }
  )
}
