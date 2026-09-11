import { createHmac, timingSafeEqual } from 'crypto'

// Verification for HubSpot's v3 request signature.
//
// This is the only thing standing between the webhook endpoint and anyone who
// discovers its URL. The endpoint accepts events that cause Slack messages,
// Notion rows and outbound webhooks to fire on a customer's behalf, so an
// unverified endpoint lets a stranger drive a customer's automations.
//
// Per HubSpot's specification the signed string is, in this exact order:
//
//     requestMethod + requestUri + requestBody + timestamp
//
// hashed with HMAC-SHA256 keyed on the app's client secret, Base64 encoded.
// Requests older than five minutes must be rejected.

const MAX_AGE_MS = 5 * 60 * 1000

export const SIGNATURE_HEADER = 'x-hubspot-signature-v3'
export const TIMESTAMP_HEADER = 'x-hubspot-request-timestamp'

export type SignatureCheck =
  | { valid: true }
  | { valid: false; reason: string }

/**
 * Verifies a v3-signed HubSpot request.
 *
 * `uri` must be the absolute URL exactly as HubSpot called it, including
 * scheme and host. It is passed in rather than read from the request because
 * behind Vercel's proxy the incoming `req.url` is not necessarily the public
 * URL HubSpot signed — the caller builds it from the configured public origin,
 * which is the same value registered in the HubSpot app.
 *
 * `body` must be the raw request text. Parsing and re-serialising JSON changes
 * bytes (key order, whitespace, unicode escaping) and the signature will not
 * match.
 */
export function verifyHubSpotSignature(params: {
  method: string
  uri: string
  body: string
  signature: string | null
  timestamp: string | null
  clientSecret: string
  now?: number
}): SignatureCheck {
  const { method, uri, body, signature, timestamp, clientSecret } = params
  const now = params.now ?? Date.now()

  if (!signature) return { valid: false, reason: 'missing signature header' }
  if (!timestamp) return { valid: false, reason: 'missing timestamp header' }

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) {
    return { valid: false, reason: 'timestamp is not a number' }
  }

  // Reject stale requests, and future-dated ones too. A timestamp far ahead of
  // now would otherwise let a captured request stay replayable for as long as
  // the attacker chose.
  if (Math.abs(now - ts) > MAX_AGE_MS) {
    return { valid: false, reason: 'timestamp outside the 5 minute window' }
  }

  const expected = createHmac('sha256', clientSecret)
    .update(`${method}${uri}${body}${timestamp}`, 'utf8')
    .digest()

  let provided: Buffer
  try {
    provided = Buffer.from(signature, 'base64')
  } catch {
    return { valid: false, reason: 'signature is not valid base64' }
  }

  // timingSafeEqual throws on a length mismatch, so compare lengths first.
  // The comparison itself must be constant-time: a byte-by-byte comparison
  // leaks, through response timing, how much of a guessed signature was
  // correct, which is enough to reconstruct a valid one.
  if (expected.length !== provided.length) {
    return { valid: false, reason: 'signature length mismatch' }
  }
  if (!timingSafeEqual(expected, provided)) {
    return { valid: false, reason: 'signature mismatch' }
  }

  return { valid: true }
}

/**
 * Builds the URI string HubSpot signed.
 *
 * HubSpot signs the URL it was configured to call, so this is derived from the
 * public origin plus the path and query — not from the proxied inbound request.
 *
 * HubSpot's spec requires `%3A` and `%2F` to be decoded back to `:` and `/`
 * before hashing, while leaving the `?` that begins the query string alone.
 */
export function buildSignedUri(origin: string, pathname: string, search: string): string {
  const raw = `${origin.replace(/\/$/, '')}${pathname}${search}`
  return raw.replace(/%3A/gi, ':').replace(/%2F/gi, '/')
}

// ── Event payload ────────────────────────────────────────────────────────────

export type HubSpotWebhookEvent = {
  eventId?: number | string
  subscriptionId?: number
  portalId: number
  appId?: number
  occurredAt: number
  subscriptionType: string
  attemptNumber?: number
  objectId: number | string
  propertyName?: string
  propertyValue?: string
  changeSource?: string
}

/**
 * Parses and shallowly validates a webhook batch.
 *
 * Returns only events carrying the fields we depend on. A malformed entry is
 * dropped rather than failing the batch — rejecting the whole delivery because
 * HubSpot added a field or sent one odd event would make them retry the entire
 * batch indefinitely, including the events that were fine.
 */
export function parseWebhookBatch(body: string): HubSpotWebhookEvent[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  return parsed.filter((e): e is HubSpotWebhookEvent => {
    if (!e || typeof e !== 'object') return false
    const ev = e as Record<string, unknown>
    return (
      typeof ev.portalId === 'number' &&
      typeof ev.subscriptionType === 'string' &&
      (typeof ev.objectId === 'number' || typeof ev.objectId === 'string') &&
      typeof ev.occurredAt === 'number'
    )
  })
}
