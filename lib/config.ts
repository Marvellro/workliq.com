// Single source of truth for URLs and Supabase clients.
//
// These were previously redeclared per-route, which is how the OAuth host
// mismatch crept in: app/api/auth/hubspot/route.ts used
// `https://www.workliq.com/api/auth/hubspot/callback` while lib/hubspot.ts used
// the apex `https://workliq.com/...` for the refresh call. Since the OAuth
// state cookie is host-only, starting the flow on one host and landing on the
// other means the cookie never arrives and every connection attempt fails the
// CSRF check.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// The canonical host. Every OAuth redirect_uri is built from this, so all
// providers agree and the state cookie is always in scope.
//
// This MUST match the redirect URI registered in each provider's app settings
// (HubSpot, Slack, Notion). Changing it means updating those three dashboards.
export const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL || 'https://www.workliq.com'
).replace(/\/$/, '')

export function appUrl(path: string): string {
  return `${APP_URL}${path.startsWith('/') ? path : `/${path}`}`
}

export const OAUTH_REDIRECT_URIS = {
  hubspot: appUrl('/api/auth/hubspot/callback'),
  slack: appUrl('/api/auth/slack/callback'),
  notion: appUrl('/api/auth/notion/callback'),
} as const

// ── Supabase clients ─────────────────────────────────────────────────────────

// Service-role client: bypasses RLS entirely. Every query made with it must
// carry its own `.eq('customer_id', session.customerId)` scope — RLS is not
// there to catch a mistake.
export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set'
    )
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function getSupabaseAnon(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set'
    )
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// ── Session cookies ──────────────────────────────────────────────────────────

export const ACCESS_TOKEN_COOKIE = 'sb-access-token'
export const REFRESH_TOKEN_COOKIE = 'sb-refresh-token'
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_MAX_AGE,
}
