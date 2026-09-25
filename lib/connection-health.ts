import { getSupabaseAdmin } from './config'

// Connection health: telling "this credential is temporarily unhappy" apart
// from "this credential is dead and only the customer can fix it".
//
// The queue already had one axis of classification — PermanentJobError stops
// the retries — but nothing recorded *why* against the connection itself. So a
// customer who uninstalled the HubSpot app got five backoff-spaced retries
// against a refresh token HubSpot had already invalidated, a dead-lettered job,
// and no indication anywhere that the thing to fix was the connection.
//
// A ConnectionError answers both questions at once: stop retrying, and mark
// this provider as needing the customer's attention.

export type ConnectionProvider = 'hubspot' | 'slack' | 'notion'

const TABLES: Record<ConnectionProvider, string> = {
  hubspot: 'hubspot_connections',
  slack: 'slack_connections',
  notion: 'notion_connections',
}

const LABELS: Record<ConnectionProvider, string> = {
  hubspot: 'HubSpot',
  slack: 'Slack',
  notion: 'Notion',
}

export function providerLabel(provider: ConnectionProvider): string {
  return LABELS[provider]
}

/** Keeps a stored error readable and bounded — API bodies can be long. */
const MAX_DETAIL = 500

/**
 * A credential that will not start working again on its own.
 *
 * Carries `customerId` rather than relying on the job's, so the same error
 * thrown outside the queue — a dashboard "Send test message" button, an
 * interactive reconnect — marks the connection just as well.
 *
 * `message` is written to workflow_runs.error_message and shown to the
 * customer, so it says what they should do, not what the API said. The raw
 * response goes in `detail` and is kept on the connection row for support.
 */
export class ConnectionError extends Error {
  readonly provider: ConnectionProvider
  readonly customerId: string
  readonly detail: string

  constructor(args: {
    provider: ConnectionProvider
    customerId: string
    /** Customer-facing. Reads as an instruction, not an error dump. */
    message: string
    /** Raw response text, for support. Truncated on the way in. */
    detail?: string
  }) {
    super(args.message)
    this.name = 'ConnectionError'
    this.provider = args.provider
    this.customerId = args.customerId
    this.detail = (args.detail ?? args.message).slice(0, MAX_DETAIL)
  }
}

// ── Recording ────────────────────────────────────────────────────────────────

/**
 * Flags a connection as needing the customer to reconnect.
 *
 * Returns whether this call was the *transition* into broken. Only the first
 * failure returns true: a dead HubSpot grant fails every workflow on every
 * sweep, and the digest must be driven by the break, not by each symptom.
 *
 * `last_error` deliberately stores the customer-facing message, not the raw
 * provider response. That column is read straight into the dashboard banner and
 * the digest email, so what lands in it is what a customer reads — and a
 * third-party error body is not something to forward to someone's inbox
 * unexamined. The raw detail goes to the logs, where support wants it anyway.
 *
 * Never throws. This is bookkeeping about a failure that has already happened;
 * letting it raise would replace a precise "your Slack connection is dead" with
 * a vague database error and lose the diagnosis.
 */
export async function markConnectionUnhealthy(
  err: ConnectionError
): Promise<{ transitioned: boolean }> {
  // Raw provider response, for support. Kept out of the database on purpose.
  console.error(
    `[connection-health] ${err.provider} broken for ${err.customerId}: ${err.detail}`
  )

  try {
    const supabase = getSupabaseAdmin()
    const now = new Date().toISOString()

    // Transition detection without a read-then-write race: only the update that
    // actually flips 'active' -> 'needs_reauth' matches a row, so exactly one
    // concurrent caller can come away with transitioned = true.
    const { data: flipped, error } = await supabase
      .from(TABLES[err.provider])
      .update({ status: 'needs_reauth', last_error: err.message, last_error_at: now })
      .eq('customer_id', err.customerId)
      .eq('status', 'active')
      .select('id')

    if (error) {
      console.error(
        `[connection-health] could not flag ${err.provider} for ${err.customerId}:`,
        error.message
      )
      return { transitioned: false }
    }

    if (flipped && flipped.length > 0) return { transitioned: true }

    // Already known broken. Refresh the message anyway — the reason can change
    // (a scope problem becoming a revoked token) and the banner should say
    // what is wrong now, not what was wrong first.
    await supabase
      .from(TABLES[err.provider])
      .update({ last_error: err.message, last_error_at: now })
      .eq('customer_id', err.customerId)

    return { transitioned: false }
  } catch (cause) {
    console.error('[connection-health] markConnectionUnhealthy threw:', cause)
    return { transitioned: false }
  }
}

/**
 * Records that a connection just worked, clearing any previous failure.
 *
 * Also never throws: a workflow that genuinely delivered must not be reported
 * as failed because the health write afterwards did not land.
 *
 * This is one extra UPDATE per successful action. At current volumes that is
 * irrelevant, and the "last worked at" it buys is what distinguishes a quiet
 * account from a broken one. If action volume ever makes the write matter, the
 * cheap fix is to skip it when status is already 'active' and last_success_at
 * is recent, rather than to drop the timestamp.
 */
export async function recordConnectionSuccess(
  customerId: string,
  provider: ConnectionProvider
): Promise<void> {
  try {
    const { error } = await getSupabaseAdmin()
      .from(TABLES[provider])
      .update({
        status: 'active',
        last_error: null,
        last_error_at: null,
        last_success_at: new Date().toISOString(),
        // Back to null so a SECOND break is notifiable. Leaving a stamp here
        // would silence the digest for every future failure of this connection.
        broken_notified_at: null,
      })
      .eq('customer_id', customerId)

    if (error) {
      console.warn(
        `[connection-health] could not record ${provider} success for ${customerId}:`,
        error.message
      )
    }
  } catch (cause) {
    console.warn('[connection-health] recordConnectionSuccess threw:', cause)
  }
}

// ── Classification ───────────────────────────────────────────────────────────
//
// Each of these returns a ConnectionError when the response proves the
// credential is dead, and null when it does not. Null means "treat this like
// any other failure": the caller throws its own error and the queue retries.
//
// The bar for returning non-null is deliberately high. A false positive tells a
// customer to go and reconnect something that was working, which costs more
// trust than a retry costs money.

function bodyHas(body: string, needles: readonly string[]): boolean {
  const haystack = body.toLowerCase()
  return needles.some((n) => haystack.includes(n.toLowerCase()))
}

/**
 * HubSpot's OAuth token endpoint, refreshing an access token.
 *
 * HubSpot answers 400 with `invalid_grant` / `BAD_REFRESH_TOKEN` when the
 * refresh token is expired, revoked, or — the common case — invalidated because
 * someone uninstalled the app from the portal. None of that recovers by itself.
 *
 * The exclusion list matters more than the inclusion list. `invalid_client`,
 * a bad redirect URI and a malformed grant type are all *our* misconfiguration,
 * and they fail identically for every customer at once. Treating those as a
 * dead grant would flag the entire customer base as needing to reconnect over a
 * wrong environment variable — which is precisely the shape of the apex/www
 * redirect_uri bug this codebase has already hit once. Those stay generic
 * errors so they keep retrying, stay loud in the logs, and blame nobody.
 */
const HUBSPOT_OUR_FAULT = [
  'invalid_client',
  'BAD_CLIENT_ID',
  'BAD_CLIENT_SECRET',
  'BAD_REDIRECT_URI',
  'BAD_GRANT_TYPE',
] as const

export function hubspotRefreshFailure(
  customerId: string,
  status: number,
  body: string
): ConnectionError | null {
  if (status !== 400 && status !== 401) return null
  if (bodyHas(body, HUBSPOT_OUR_FAULT)) return null

  return new ConnectionError({
    provider: 'hubspot',
    customerId,
    message:
      'Your HubSpot connection is no longer valid — reconnect HubSpot to resume ' +
      'these workflows. This usually means the Workliq app was uninstalled or ' +
      'its access was revoked in your HubSpot account.',
    detail: `HubSpot token refresh failed (${status}): ${body}`,
  })
}

/**
 * A HubSpot CRM API call made with an access token we believed was good.
 *
 * 401 is the token being rejected. 403 is the token lacking a scope, which the
 * customer can only grant by reconnecting — so both route to the same place.
 */
export function hubspotApiFailure(
  customerId: string,
  status: number,
  body: string
): ConnectionError | null {
  if (status !== 401 && status !== 403) return null

  return new ConnectionError({
    provider: 'hubspot',
    customerId,
    message:
      status === 403
        ? 'Workliq no longer has permission to read this data from HubSpot — ' +
          'reconnect HubSpot to grant access again.'
        : 'Your HubSpot connection was rejected — reconnect HubSpot to resume ' +
          'these workflows.',
    detail: `HubSpot API returned ${status}: ${body}`,
  })
}

/**
 * A Slack incoming webhook POST.
 *
 * Slack returns 400, 403 and 404 with a plain-text error body. Two of those
 * bodies are explicitly not connection problems:
 *
 *   invalid_payload — the JSON we sent is malformed. Our bug.
 *   rollup_error    — Slack's own wording is that it was likely not your fault.
 *
 * Both are checked first so a status-code match can't reclassify them.
 */
const SLACK_OUR_FAULT = ['invalid_payload', 'too_many_attachments', 'rollup_error'] as const

const SLACK_DEAD = [
  'invalid_token',      // the webhook credential is expired, revoked or missing
  'no_active_hooks',    // the incoming webhook has been disabled
  'no_service',         // the app was removed from the workspace
  'no_team',            // the workspace itself is gone
  'channel_not_found',  // the destination channel was deleted
  'channel_is_archived',
  'action_prohibited',  // workspace policy now forbids the post
] as const

export function slackWebhookFailure(
  customerId: string,
  status: number,
  body: string
): ConnectionError | null {
  if (bodyHas(body, SLACK_OUR_FAULT)) return null

  const dead = bodyHas(body, SLACK_DEAD) || status === 403 || status === 404
  if (!dead) return null

  // The channel cases are worth naming separately: the credential is fine and
  // the customer's instinct will be to look at Slack's app settings, when what
  // they actually need is to pick a different channel.
  const channelGone = bodyHas(body, ['channel_not_found', 'channel_is_archived'])

  return new ConnectionError({
    provider: 'slack',
    customerId,
    message: channelGone
      ? 'The Slack channel Workliq posts to is archived or no longer exists — ' +
        'reconnect Slack and choose a channel that is still active.'
      : 'Your Slack connection is no longer valid — reconnect Slack to resume ' +
        'these alerts.',
    detail: `Slack webhook returned ${status}: ${body}`,
  })
}

/**
 * A Notion API call.
 *
 *   401 unauthorized       — the token was revoked.
 *   403 restricted_resource — the integration lost access to the page.
 *   404 object_not_found   — the database we write into was deleted, or the
 *                            integration can no longer see it. Indistinguishable
 *                            from Notion's side, and both are fixed by
 *                            reconnecting, which recreates the database.
 */
export function notionFailure(
  customerId: string,
  status: number,
  body: string
): ConnectionError | null {
  if (status !== 401 && status !== 403 && status !== 404) return null

  return new ConnectionError({
    provider: 'notion',
    customerId,
    message:
      status === 404
        ? 'Workliq can no longer find the Notion database it writes to — it may ' +
          'have been deleted. Reconnect Notion to recreate it.'
        : 'Your Notion connection is no longer valid — reconnect Notion to ' +
          'resume writing rows.',
    detail: `Notion API returned ${status}: ${body}`,
  })
}
