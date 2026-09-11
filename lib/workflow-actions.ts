import { safePostJson } from './safe-fetch'
import { signWebhookPayload, generateWebhookSecret } from './crypto'
import { getSupabaseAdmin } from './config'

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

export type SlackConnection = { webhook_url: string }
export type NotionConnection = { access_token: string; database_id: string }

export async function sendSlackMessage(webhookUrl: string, text: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })

  // Incoming webhooks always return HTTP 200 with text body "ok" on success.
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Slack webhook returned ${res.status}: ${body}`)
  }
}

// properties uses Notion's page-property format directly, e.g.
//   { 'Deal Name': { title: [{ text: { content: 'Acme deal' } }] } }
// Callers build this per trigger type since not every property applies to
// every event (e.g. "Days Stale" only makes sense for the stale trigger).
export async function createNotionPage(
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
    throw new Error(`Notion page creation returned ${res.status}: ${body}`)
  }
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
    throw new Error(`Webhook returned ${res.status}: ${res.body.slice(0, 500)}`)
  }
}
