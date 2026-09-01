// Action executors for the workflow engine. These are intentionally separate
// from the postSlackAlert/createNotionRow helpers inside stale-deals/route.ts —
// that cron job's format (stale-deal-specific Slack text, Days Stale / Threshold
// Notion columns) is fixed and already live in production, so it's left alone.
// These versions are generic: any workflow, any trigger type, builds its own
// text/properties and passes them in.

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

export async function callWebhook(url: string, payload: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  // Unlike Slack's incoming webhooks, arbitrary customer endpoints may return
  // any 2xx on success — we only treat non-2xx as a genuine failure.
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Webhook returned ${res.status}: ${body}`)
  }
}
