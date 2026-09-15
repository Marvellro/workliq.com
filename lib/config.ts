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

// OAuth client IDs.
//
// These are NOT secrets — every one of them is sent to the browser as a query
// parameter on the authorize URL. They live in env vars so the value can be
// changed without a deploy (the Slack ID was wrong by a single digit for
// months, and correcting it required shipping code), and so a staging app can
// point at a different provider app.
//
// Deliberately not NEXT_PUBLIC_: they are only read server-side, and the
// NEXT_PUBLIC_ prefix would inline them at build time — losing the
// change-without-deploy property that is the whole point.
//
// The literals are fallbacks so a missing variable degrades to the current
// production app rather than breaking OAuth outright.
export const OAUTH_CLIENT_IDS = {
  hubspot: process.env.HUBSPOT_CLIENT_ID || '399fbd57-9bd1-4d3a-926a-31f18232704f',
  slack: process.env.SLACK_CLIENT_ID || '11395615844631.11439398705216',
  notion: process.env.NOTION_CLIENT_ID || '386d872b-594c-8162-84f2-00370d6f32cc',
} as const

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
