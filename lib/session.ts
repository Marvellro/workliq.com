import { cookies } from 'next/headers'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  SESSION_COOKIE_OPTIONS,
  getSupabaseAnon,
} from './config'

export type CustomerSession = {
  customerId: string
  email: string
}

// This Supabase project signs JWTs with an asymmetric ES256 key and publishes
// the public half at /auth/v1/.well-known/jwks.json. That lets us verify a
// session locally instead of calling out to Supabase.
//
// The previous implementation called `supabase.auth.setSession()` on every
// request, which had two real problems:
//
//   1. A network round-trip to Supabase on every authenticated request —
//      latency on every page load and API call, and an outage in Supabase Auth
//      logs everyone out even for pages that never touch the database.
//
//   2. setSession() rotates the refresh token, but the rotated token was never
//      written back to the cookie. The cookie kept the now-consumed token, so
//      once the access token expired the stored refresh token was already spent
//      and the session died — users being logged out "randomly" after an hour.
//
// Verifying locally fixes (1); handling refresh explicitly below fixes (2).

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null

function getJWKS() {
  if (jwks) return jwks
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL must be set')
  // createRemoteJWKSet caches the key set in memory and re-fetches only when it
  // sees an unknown `kid`, so this is one fetch per cold start, not per request.
  jwks = createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`))
  return jwks
}

type SupabaseJWT = JWTPayload & {
  sub?: string
  email?: string
  session_id?: string
}

/**
 * Returns the authenticated customer, or null if there is no valid session.
 *
 * Verifies the access token's signature locally. If the access token has
 * expired but a refresh token is present, exchanges it for a new session and
 * writes the rotated pair back to the cookies.
 */
export async function getCustomerSession(): Promise<CustomerSession | null> {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value

  if (!accessToken && !refreshToken) return null

  if (accessToken) {
    try {
      const { payload } = await jwtVerify<SupabaseJWT>(accessToken, getJWKS(), {
        // Supabase issues access tokens with aud "authenticated". Checking it
        // stops a token minted for some other audience (a service token, a
        // token from another Supabase project sharing an issuer) from being
        // accepted as a customer login.
        audience: 'authenticated',
      })
      // jwtVerify already enforces `exp` and `nbf`.
      if (payload.sub && payload.email) {
        return { customerId: payload.sub, email: payload.email }
      }
      return null
    } catch {
      // Expired or invalid — fall through to the refresh path below. We don't
      // distinguish the two here: an invalid token with no usable refresh token
      // ends up at the same place (null), and a valid refresh token should
      // recover the session either way.
    }
  }

  if (!refreshToken) return null
  return refreshSession(refreshToken)
}

async function refreshSession(refreshToken: string): Promise<CustomerSession | null> {
  const { data, error } = await getSupabaseAnon().auth.refreshSession({
    refresh_token: refreshToken,
  })

  if (error || !data.session || !data.user?.email) return null

  // Persist the rotated tokens. Supabase invalidates the old refresh token on
  // use, so failing to write these back is what broke sessions previously.
  //
  // Next only permits cookie writes from a Server Action or Route Handler; in a
  // Server Component render this throws. That's survivable — the caller still
  // gets a valid session for this request, and the next mutation refreshes
  // again. So we swallow it rather than failing the whole request.
  try {
    const cookieStore = await cookies()
    cookieStore.set(ACCESS_TOKEN_COOKIE, data.session.access_token, SESSION_COOKIE_OPTIONS)
    cookieStore.set(REFRESH_TOKEN_COOKIE, data.session.refresh_token, SESSION_COOKIE_OPTIONS)
  } catch {
    // Read-only cookie context — see above.
  }

  return { customerId: data.user.id, email: data.user.email }
}

/**
 * Session accessor for API routes that must reject rather than redirect.
 * Returns the session or throws `UnauthorizedError`.
 */
export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export async function requireCustomerSession(): Promise<CustomerSession> {
  const session = await getCustomerSession()
  if (!session) throw new UnauthorizedError()
  return session
}
