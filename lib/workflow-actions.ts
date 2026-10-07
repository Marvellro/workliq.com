import { safePostJson } from './safe-fetch'
import { signWebhookPayload, generateWebhookSecret } from './crypto'
import { getSupabaseAdmin } from './config'
import {
  slackWebhookFailure,
  notionFailure,
  recordConnectionSuccess,
} from './connection-health'

// Action executors for the workflow engine. These are intentionally separate
// from the postSlackAlert/createNotionRow helpers inside stale-deals/route.ts —
// that cron job's format (stale-deal-specific Slack text, Days Stale / Threshold
// Notion columns) is fixed and already live in production, so it's left alone.
// These versions are generic: any workflow, any trigger type, builds its own
// text/properties and passes them in.
//
// Credentials reaching these functions are already decrypted by the caller
// (see app/api/cron/workflows/route.ts) — decryption happens once per customer
// per run rather than once per action.

const NOTION_VERSION = '2022-06-28'

/** Longest response excerpt worth putting in front of a customer. */
const MAX_QUOTED_BODY = 200

/**
 * Turns a failed response body into something worth reading.
 *
 * Error text goes into `workflow_runs.error_message`, which is what a customer
 * reads in the activity feed at exactly the moment something has broken. The
 * previous code sliced the raw body to 500 characters regardless of what it
 * was, so a 404 from any endpoint that serves an HTML error page filled that
 * field with `<!DOCTYPE html><html lang="en" class="geist_a715…`.
 *
 * Markup is dropped entirely rather than stripped: for an HTML error page the
 * status code already carries the whole message, and a de-tagged page is just
 * navigation text. An API returning JSON or plain text usually says something
 * genuinely useful, so that is kept, collapsed and short.
 */
export function summariseResponseBody(body: string): string {
  const trimmed = body.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('<')) return ''

  const collapsed = trimmed.replace(/\s+/g, ' ')
  return collapsed.length > MAX_QUOTED_BODY
    ? `${collapsed.slice(0, MAX_QUOTED_BODY)}…`
    : collapsed
}

/** `Webhook returned 404` when there is nothing useful to add. */
function failureMessage(label: string, status: number, body: string): string {
  const detail = summariseResponseBody(body)
  return detail ? `${label} returned ${status}: ${detail}` : `${label} returned ${status}`
}

export type SlackConnection = { webhook_url: string }
export type NotionConnection = { access_token: string; database_id: string }

// customerId is here only so a failure can be attributed to a connection. It is
// not used to look anything up — the caller has already decrypted and passed
// the credential — but without it a dead webhook is just an error string with
// no owner, which is how these used to disappear.
export async function sendSlackMessage(
  customerId: string,
  webhookUrl: string,
  text: string
): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })

  // Incoming webhooks always return HTTP 200 with text body "ok" on success.
  if (!res.ok) {
    const body = await res.text()

    const dead = slackWebhookFailure(customerId, res.status, body)
    if (dead) throw dead

    throw new Error(failureMessage('Slack webhook', res.status, body))
  }

  await recordConnectionSuccess(customerId, 'slack')
}

// properties uses Notion's page-property format directly, e.g.
//   { 'Deal Name': { title: [{ text: { content: 'Acme deal' } }] } }
// Callers build this per trigger type since not every property applies to
// every event (e.g. "Days Stale" only makes sense for the stale trigger).
export async function createNotionPage(
  customerId: string,
  conn: NotionConnection,
  properties: Record<string, unknown>
): Promise<void> {
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${conn.access_token}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: JSON.stringify({
      parent: { database_id: conn.database_id },
      properties,
    }),
  })

  if (!res.ok) {
    const body = await res.text()

    // 404 is the one worth calling out: it does not mean Notion is down, it
    // means the database we write into is gone. That reads as a transient
    // "not found" and is in fact terminal until the customer reconnects.
    const dead = notionFailure(customerId, res.status, body)
    if (dead) throw dead

    throw new Error(failureMessage('Notion page creation', res.status, body))
  }

  await recordConnectionSuccess(customerId, 'notion')
}

/**
 * Returns the customer's outbound webhook signing secret, creating one on first
 * use.
 *
 * Per-customer rather than a single global secret: with one shared secret, any
 * customer could compute a valid signature for a payload sent to another
 * customer's endpoint, and rotating after a leak would break every customer at
 * once.
 */
export async function getOrCreateWebhookSecret(customerId: string): Promise<string> {
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from('customers')
    .select('webhook_secret')
    .eq('id', customerId)
    .single()

  if (error) throw new Error(`Could not load webhook secret: ${error.message}`)
  if (data?.webhook_secret) return data.webhook_secret

  const secret = generateWebhookSecret()
  const { error: updateError } = await supabase
    .from('customers')
    .update({ webhook_secret: secret })
    .eq('id', customerId)

  if (updateError) {
    throw new Error(`Could not store webhook secret: ${updateError.message}`)
  }
  return secret
}

/**
 * Delivers a workflow payload to a customer-controlled URL.
 *
 * Two protections the previous implementation lacked:
 *
 *   1. `safePostJson` re-resolves DNS and refuses private, loopback and
 *      link-local targets, so a workflow cannot be pointed at cloud metadata
 *      (169.254.169.254) or anything else inside our network. Requiring an
 *      `https://` prefix at save time did nothing about this.
 *
 *   2. Every delivery is signed. Without a signature the receiving endpoint has
 *      no way to distinguish a genuine Workliq call from anyone who guessed the
 *      URL, so acting on the payload would be unsafe.
 */
export async function callWebhook(
  url: string,
  payload: unknown,
  secret: string
): Promise<void> {
  // Serialise once, sign those bytes, send those same bytes. safePostJson takes
  // a string precisely so the signature always covers what is transmitted.
  const body = JSON.stringify(payload)
  const { timestamp, signature } = signWebhookPayload(secret, body)

  const res = await safePostJson(url, body, {
    'X-Workliq-Timestamp': timestamp,
    'X-Workliq-Signature': `sha256=${signature}`,
    'User-Agent': 'Workliq-Webhook/1.0',
  })

  // Unlike Slack's incoming webhooks, arbitrary customer endpoints may return
  // any 2xx on success — we only treat non-2xx as a genuine failure.
  if (!res.ok) {
    throw new Error(failureMessage('Webhook', res.status, res.body))
  }
}
