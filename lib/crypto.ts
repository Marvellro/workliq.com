import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto'

// Application-layer encryption for third-party credentials (HubSpot tokens,
// Slack webhook URLs, Notion tokens).
//
// Why encrypt in the app rather than using Supabase Vault or relying on
// volume-level encryption: both of those decrypt transparently for anyone
// holding database credentials. If the service-role key leaks — or a backup,
// a dump, or a mis-scoped query escapes — plaintext tokens go with it, and a
// HubSpot refresh token is a permanent read of that customer's entire CRM.
//
// Encrypting here means the database alone is inert. Reading a customer's
// tokens requires BOTH the database and WORKLIQ_ENCRYPTION_KEY, which lives
// only in the runtime environment and is never sent to Postgres.

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12 // 96-bit nonce — the size GCM is defined for
const KEY_BYTES = 32 // AES-256

// Ciphertext is stored as a self-describing string:
//   v<version>:<iv-b64>:<tag-b64>:<ciphertext-b64>
// The version prefix lets us rotate keys without a flag day: a new key ships
// as v2, decrypt() picks the right key per row from the prefix, and rows are
// re-encrypted lazily or by a backfill. Without the prefix, rotation would
// mean taking the app down to re-encrypt everything at once.
const CURRENT_VERSION = 1
const ENVELOPE_RE = /^v(\d+):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]*)$/

// Keys are read lazily rather than at module load. Importing this module must
// not throw in contexts that never encrypt anything (the build step, a route
// that only reads public data) — otherwise a missing env var in preview takes
// down pages that have no business needing it.
let keyCache: Map<number, Buffer> | null = null

function loadKeys(): Map<number, Buffer> {
  if (keyCache) return keyCache

  const keys = new Map<number, Buffer>()

  const primary = process.env.WORKLIQ_ENCRYPTION_KEY
  if (!primary) {
    throw new Error(
      'WORKLIQ_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32'
    )
  }
  keys.set(CURRENT_VERSION, parseKey(primary, 'WORKLIQ_ENCRYPTION_KEY'))

  // Previous keys stay loadable so rows encrypted under them still decrypt
  // during a rotation. Format: WORKLIQ_ENCRYPTION_KEY_V1, ..._V2, etc.
  for (let v = 1; v < CURRENT_VERSION; v++) {
    const old = process.env[`WORKLIQ_ENCRYPTION_KEY_V${v}`]
    if (old) keys.set(v, parseKey(old, `WORKLIQ_ENCRYPTION_KEY_V${v}`))
  }

  keyCache = keys
  return keys
}

function parseKey(raw: string, name: string): Buffer {
  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `${name} must decode to exactly ${KEY_BYTES} bytes (got ${key.length}). ` +
        'Generate one with: openssl rand -base64 32'
    )
  }
  return key
}

// Test seam: lets the suite install known keys without mutating process.env
// across test files. Not used in application code.
export function __setKeysForTesting(keys: Map<number, Buffer> | null): void {
  keyCache = keys
}

/**
 * Encrypts a credential for storage. Returns a versioned envelope string.
 *
 * Every call uses a fresh random IV, so encrypting the same token twice yields
 * different ciphertext — an attacker with read access to the table cannot tell
 * which customers share a value.
 */
export function encrypt(plaintext: string): string {
  const key = loadKeys().get(CURRENT_VERSION)!
  const iv = randomBytes(IV_BYTES)

  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  return [
    `v${CURRENT_VERSION}`,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':')
}

/**
 * Decrypts a stored credential.
 *
 * GCM authenticates as well as encrypts: if the ciphertext, IV, or tag has
 * been altered, `decipher.final()` throws rather than returning corrupted
 * plaintext. So a tampered row fails loudly instead of, say, redirecting a
 * customer's Slack alerts to an attacker's webhook.
 *
 * Throws on anything that isn't an envelope.
 *
 * This used to pass plaintext through unchanged, which was the migration path:
 * rows written before encryption shipped were still plaintext, and the live
 * cron had to keep working while the backfill ran. That backfill completed on
 * 2026-09-12 — every credential column is now `v1:` and re-running the script
 * reports zero plaintext values — so the passthrough has been removed.
 *
 * Failing loudly is the point. With the passthrough in place, a credential that
 * somehow reached the database unencrypted would be used quite happily and
 * nobody would ever discover it. Now it stops the request instead, which is the
 * only way that bug becomes visible.
 */
export function decrypt(stored: string): string {
  const match = ENVELOPE_RE.exec(stored)
  if (!match) {
    // Deliberately does not include the value: this message goes to logs, and
    // the thing being rejected may well be a live credential.
    throw new Error(
      'Expected an encrypted credential but found an unencrypted value. ' +
        'Run `npm run backfill:encryption` to check for unencrypted rows.'
    )
  }

  const [, versionStr, ivB64, tagB64, ctB64] = match
  const version = Number(versionStr)

  const key = loadKeys().get(version)
  if (!key) {
    throw new Error(
      `No decryption key available for envelope version ${version}. ` +
        `Set WORKLIQ_ENCRYPTION_KEY_V${version} to decrypt rows written under that key.`
    )
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))

  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

/** True if the value is already an encryption envelope (used by the backfill). */
export function isEncrypted(value: string): boolean {
  return ENVELOPE_RE.test(value)
}

// ── Webhook signing ──────────────────────────────────────────────────────────

// Customers receiving our outbound webhooks need a way to prove a payload came
// from Workliq and isn't a replay. We sign `<timestamp>.<body>` rather than the
// body alone: signing the body alone would let anyone who captured one request
// replay it forever.

export type WebhookSignature = {
  timestamp: string
  signature: string
}

export function signWebhookPayload(secret: string, body: string, now = Date.now()): WebhookSignature {
  const timestamp = Math.floor(now / 1000).toString()
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex')
  return { timestamp, signature }
}

/**
 * Verifies a signature we produced. Exposed mainly so the test suite and any
 * future inbound Workliq-to-Workliq calls use exactly the same comparison —
 * in particular `timingSafeEqual`, so an attacker can't recover a valid
 * signature byte-by-byte from response timing.
 */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  timestamp: string,
  signature: string,
  toleranceSeconds = 300,
  now = Date.now()
): boolean {
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false

  // Reject anything outside the tolerance window in either direction. Future
  // timestamps are rejected too — a clock-skewed or forged-ahead timestamp
  // would otherwise extend a captured request's replay window indefinitely.
  const ageSeconds = Math.abs(Math.floor(now / 1000) - ts)
  if (ageSeconds > toleranceSeconds) return false

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest()
  const provided = Buffer.from(signature, 'hex')

  // timingSafeEqual throws on length mismatch, so check length first.
  if (expected.length !== provided.length) return false
  return timingSafeEqual(expected, provided)
}

/**
 * Generates a per-customer webhook signing secret.
 *
 * Prefixed `wlq_whsec_` rather than the bare `whsec_` Stripe uses: a distinct
 * prefix makes the secret's origin obvious in a customer's own config, and
 * keeps it from being misread (by a person or a secret scanner) as a Stripe
 * credential.
 */
export function generateWebhookSecret(): string {
  return `wlq_whsec_${randomBytes(24).toString('hex')}`
}
