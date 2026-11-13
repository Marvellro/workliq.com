import { getSupabaseAdmin, OAUTH_CLIENT_IDS, OAUTH_REDIRECT_URIS } from './config'
import { decrypt } from './crypto'
import {
  hubspotRefreshFailure,
  slackWebhookFailure,
  type ConnectionProvider,
} from './connection-health'
import { providersUsedBy } from './connections'
import { stepsFor } from './workflow-steps'
import type { WorkflowRow } from './workflow-engine'

// Disconnecting an integration.
//
// Three documents promised this — the docs page, the support FAQ and the
// privacy policy — and a fourth said it did not exist. Until it did, the only
// way to make Workliq stop holding a customer's CRM credentials was to delete
// the whole account.
//
// ── Order ────────────────────────────────────────────────────────────────────
//   1. Pause the workflows that need this connection.
//   2. Delete our copy of the credentials.
//   3. Delete what we cached from it, and the queued work that would use it.
//   4. Ask the provider to revoke our access, using the credentials read in
//      step 1, which from here on exist only in this request's memory.
//
// Pausing comes first because the opposite failure is worse: a deleted
// connection with its workflows still on fails on every deal, and each failure
// becomes a dead job and a digest email about an outage the customer caused
// on purpose. Paused-but-still-connected is visible and fixed by trying again.
//
// Deleting comes before revoking — the reverse of account deletion, where
// Stripe goes first — because what the customer is asking for is that we no
// longer hold access. That must not wait on a third party's uptime. A provider
// that cannot be reached leaves a credential we no longer have, and the
// customer is told to remove the app on the provider's side.
//
// ── What "revoked" means ─────────────────────────────────────────────────────
// It is only reported when the provider proves it, never on the strength of a
// 200. HubSpot's revoke endpoint answers 200 with an empty body to a made-up
// client and a made-up token (measured 13 Nov 2026), so its answer says
// nothing about whether anything was revoked. Each provider below is checked
// by something that cannot pass while our access still works.

export type RevocationOutcome =
  /** The provider confirmed our access is gone, as a result of this request. */
  | 'revoked'
  /** The provider refused the credential before we asked: it was already dead. */
  | 'already_revoked'
  /** Could not be proven. The customer is told to remove the app themselves. */
  | 'unconfirmed'

export type Revocation = { outcome: RevocationOutcome; detail: string }

/** Provider calls are made inside a customer's click; none may hang it. */
const PROVIDER_TIMEOUT_MS = 10_000

const HUBSPOT_TOKEN_URL = 'https://api.hubapi.com/oauth/2026-03/token'
const HUBSPOT_REVOKE_URL = 'https://api.hubapi.com/oauth/2026-03/token/revoke'
// Named in HubSpot's May 2026 certification requirements as the endpoint an
// app must use to remove itself. "Fully removes your app from a customer's
// HubSpot account, including all associated features and webhooks." Answers
// 204 on success; 401 to a token it does not accept.
const HUBSPOT_UNINSTALL_URL = 'https://api.hubapi.com/appinstalls/v3/external-install'

const SLACK_REVOKE_URL = 'https://slack.com/api/auth.revoke'

const NOTION_REVOKE_URL = 'https://api.notion.com/v1/oauth/revoke'
const NOTION_ME_URL = 'https://api.notion.com/v1/users/me'
// The revoke endpoint documents only this version. Everything else in the
// codebase still pins 2022-06-28, which /v1/users/me continues to accept.
const NOTION_REVOKE_VERSION = '2026-03-11'
const NOTION_API_VERSION = '2022-06-28'

/**
 * Provider text bound for a log line, with any of our secrets taken out.
 *
 * Error bodies are third-party text. None of the three is known to echo a
 * token back, but "not known to" is not a property worth staking a customer's
 * credential on, and the cost of checking is one replace per secret.
 */
export function scrub(text: string, secrets: readonly (string | null | undefined)[]): string {
  let out = text
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join('[redacted]')
  }
  return out.replace(/\s+/g, ' ').slice(0, 200)
}

async function bodyOf(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

// ── HubSpot ──────────────────────────────────────────────────────────────────

/**
 * Removes Workliq from the customer's HubSpot account.
 *
 * Revoking the refresh token alone is not enough: by HubSpot's own account it
 * neither uninstalls the app nor deletes access tokens already issued, and the
 * app's webhook subscriptions keep delivering that portal's deal changes to us.
 * Uninstalling is what stops them, and its 204 is the confirmation.
 *
 * `uninstall` is false when another Workliq account is connected to the same
 * portal: removing the app would cut that account off too. The refresh token is
 * still revoked, and the outcome is unconfirmed, which tells the customer to
 * finish the job in HubSpot — a decision that is theirs to make, not ours.
 */
export async function revokeHubSpot(
  refreshToken: string,
  options: { uninstall: boolean; customerId: string }
): Promise<Revocation> {
  const clientId = OAUTH_CLIENT_IDS.hubspot
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET ?? ''
  const secrets = [refreshToken, clientSecret]

  // A fresh access token, rather than the stored one: the uninstall endpoint
  // needs a live one, and the refresh is itself a liveness test. HubSpot
  // refusing it as a bad refresh token is HubSpot saying the grant is already
  // gone — the app was uninstalled from their side.
  let accessToken: string
  const tokensToRevoke = [refreshToken]
  try {
    const res = await fetch(HUBSPOT_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: OAUTH_REDIRECT_URIS.hubspot,
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })
    if (!res.ok) {
      const body = await bodyOf(res)
      if (hubspotRefreshFailure(options.customerId, res.status, body)) {
        return { outcome: 'already_revoked', detail: `refresh refused (${res.status})` }
      }
      return { outcome: 'unconfirmed', detail: `refresh failed (${res.status}): ${scrub(body, secrets)}` }
    }
    const data = (await res.json()) as { access_token?: string; refresh_token?: string }
    if (!data.access_token) return { outcome: 'unconfirmed', detail: 'refresh returned no access token' }
    accessToken = data.access_token
    if (data.refresh_token && data.refresh_token !== refreshToken) tokensToRevoke.push(data.refresh_token)
  } catch (err) {
    return { outcome: 'unconfirmed', detail: `refresh errored: ${err instanceof Error ? err.name : 'unknown'}` }
  }

  let uninstalled = false
  let uninstallDetail = 'skipped: portal shared with another account'
  if (options.uninstall) {
    try {
      const res = await fetch(HUBSPOT_UNINSTALL_URL, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      })
      uninstalled = res.status === 204
      uninstallDetail = uninstalled
        ? 'uninstalled (204)'
        : `uninstall answered ${res.status}: ${scrub(await bodyOf(res), [...secrets, accessToken])}`
    } catch (err) {
      uninstallDetail = `uninstall errored: ${err instanceof Error ? err.name : 'unknown'}`
    }
  }

  // Revoked regardless of the uninstall, as the documented way to end a grant.
  // The answer is not read: HubSpot gives 200 to anything here.
  for (const token of tokensToRevoke) {
    try {
      await fetch(HUBSPOT_REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          token,
          token_type_hint: 'refresh_token',
        }),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      })
    } catch {
      // Best effort by design; the outcome rests on the uninstall.
    }
  }

  return { outcome: uninstalled ? 'revoked' : 'unconfirmed', detail: uninstallDetail }
}

// ── Slack ────────────────────────────────────────────────────────────────────

/** auth.revoke errors meaning Slack no longer accepts this token at all. */
const SLACK_TOKEN_DEAD = ['invalid_auth', 'token_revoked', 'account_inactive', 'token_expired'] as const

/**
 * Revokes the bot token, then proves the incoming webhook is dead.
 *
 * Slack documents that revoking the bot token removes the incoming webhooks
 * installed with it. The webhook URL is the credential Workliq actually posts
 * with, so it is the one checked: an empty JSON body is posted to it, which a
 * live webhook rejects as having no text — posting nothing — and a dead one
 * rejects as gone. The answer is read by the same classifier delivery uses.
 */
export async function revokeSlack(
  accessToken: string,
  webhookUrl: string,
  customerId: string
): Promise<Revocation> {
  const secrets = [accessToken, webhookUrl]

  let tokenGone = false
  let revokedNow = false
  let tokenDetail: string
  try {
    const res = await fetch(SLACK_REVOKE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; revoked?: boolean; error?: string }
      | null
    if (data?.ok === true && data.revoked === true) {
      tokenGone = revokedNow = true
      tokenDetail = 'token revoked'
    } else if (data?.ok === false && (SLACK_TOKEN_DEAD as readonly string[]).includes(data.error ?? '')) {
      tokenGone = true
      tokenDetail = `token already dead (${data.error})`
    } else {
      tokenDetail = `auth.revoke answered ${res.status}: ${scrub(JSON.stringify(data), secrets)}`
    }
  } catch (err) {
    tokenDetail = `auth.revoke errored: ${err instanceof Error ? err.name : 'unknown'}`
  }

  let webhookGone = false
  let webhookDetail: string
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })
    const body = await bodyOf(res)
    webhookGone = !res.ok && slackWebhookFailure(customerId, res.status, body) !== null
    webhookDetail = `webhook answered ${res.status} ${scrub(body, secrets)}`
  } catch (err) {
    webhookDetail = `webhook check errored: ${err instanceof Error ? err.name : 'unknown'}`
  }

  const detail = `${tokenDetail}; ${webhookDetail}`
  if (!(tokenGone && webhookGone)) return { outcome: 'unconfirmed', detail }
  return { outcome: revokedNow ? 'revoked' : 'already_revoked', detail }
}

// ── Notion ───────────────────────────────────────────────────────────────────

/**
 * Revokes the token, then proves Notion no longer accepts it.
 *
 * The revoke endpoint documents no response for a token that is already dead,
 * so its own answer is not relied on. /v1/users/me is the cheapest call every
 * integration token may make, and a 401 from it is Notion refusing the token.
 */
export async function revokeNotion(accessToken: string): Promise<Revocation> {
  const clientSecret = process.env.NOTION_CLIENT_SECRET ?? ''
  const basic = Buffer.from(`${OAUTH_CLIENT_IDS.notion}:${clientSecret}`).toString('base64')
  const secrets = [accessToken, clientSecret, basic]

  let revokeAccepted = false
  let revokeDetail: string
  try {
    const res = await fetch(NOTION_REVOKE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_REVOKE_VERSION,
      },
      body: JSON.stringify({ token: accessToken }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })
    revokeAccepted = res.ok
    revokeDetail = `revoke answered ${res.status}${res.ok ? '' : `: ${scrub(await bodyOf(res), secrets)}`}`
  } catch (err) {
    revokeDetail = `revoke errored: ${err instanceof Error ? err.name : 'unknown'}`
  }

  try {
    const res = await fetch(NOTION_ME_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Notion-Version': NOTION_API_VERSION },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })
    const detail = `${revokeDetail}; token check answered ${res.status}`
    if (res.status !== 401) return { outcome: 'unconfirmed', detail }
    return { outcome: revokeAccepted ? 'revoked' : 'already_revoked', detail }
  } catch (err) {
    return {
      outcome: 'unconfirmed',
      detail: `${revokeDetail}; token check errored: ${err instanceof Error ? err.name : 'unknown'}`,
    }
  }
}

// ── The whole operation ──────────────────────────────────────────────────────

export type PausedWorkflow = { id: string; name: string }

export type DisconnectResult =
  | { status: 'not_connected' }
  | { status: 'failed'; stage: 'read' | 'pause' | 'delete'; pausedWorkflows: PausedWorkflow[] }
  | {
      status: 'disconnected'
      revocation: Revocation
      pausedWorkflows: PausedWorkflow[]
      /** False when cached data or queued jobs could not all be deleted. */
      cleanupComplete: boolean
    }

const CREDENTIAL_COLUMNS: Record<ConnectionProvider, string> = {
  hubspot: 'refresh_token, hub_id',
  slack: 'access_token, webhook_url',
  notion: 'access_token',
}

type Credentials =
  | { provider: 'hubspot'; refreshToken: string; hubId: string }
  | { provider: 'slack'; accessToken: string; webhookUrl: string }
  | { provider: 'notion'; accessToken: string }

function readCredentials(provider: ConnectionProvider, row: Record<string, string>): Credentials {
  switch (provider) {
    case 'hubspot':
      return { provider, refreshToken: decrypt(row.refresh_token), hubId: row.hub_id }
    case 'slack':
      return { provider, accessToken: decrypt(row.access_token), webhookUrl: decrypt(row.webhook_url) }
    case 'notion':
      return { provider, accessToken: decrypt(row.access_token) }
  }
}

/**
 * Disconnects one integration for one customer.
 *
 * Never throws: every failure is a result the caller can describe to the
 * customer accurately, including which part already happened.
 */
export async function disconnectConnection(
  customerId: string,
  provider: ConnectionProvider
): Promise<DisconnectResult> {
  const supabase = getSupabaseAdmin()
  const table = `${provider}_connections`

  // ── Read what we hold ──────────────────────────────────────────────────────
  const { data: row, error: readError } = await supabase
    .from(table)
    .select(CREDENTIAL_COLUMNS[provider])
    .eq('customer_id', customerId)
    .maybeSingle()

  if (readError) {
    console.error(`[disconnect] could not read ${provider} for ${customerId}:`, readError.message)
    return { status: 'failed', stage: 'read', pausedWorkflows: [] }
  }
  if (!row) return { status: 'not_connected' }

  // Decrypted now, while the row still exists. A value that will not decrypt
  // (a rotated-away key) cannot be revoked, but it is still deleted.
  let credentials: Credentials | null = null
  try {
    credentials = readCredentials(provider, row as unknown as Record<string, string>)
  } catch (err) {
    console.error(`[disconnect] could not decrypt ${provider} for ${customerId}:`, err instanceof Error ? err.message : err)
  }

  // ── 1. Pause what needs it ─────────────────────────────────────────────────
  const { data: workflows, error: listError } = await supabase
    .from('workflows')
    .select('id, name, enabled, steps, action_type, action_config')
    .eq('customer_id', customerId)

  if (listError) {
    console.error(`[disconnect] could not list workflows for ${customerId}:`, listError.message)
    return { status: 'failed', stage: 'pause', pausedWorkflows: [] }
  }

  const users = (workflows ?? []).filter((w) =>
    providersUsedBy(stepsFor(w as unknown as WorkflowRow)).includes(provider)
  )
  const toPause = users.filter((w) => w.enabled).map((w) => w.id as string)

  let pausedWorkflows: PausedWorkflow[] = []
  if (toPause.length > 0) {
    const { data: paused, error: pauseError } = await supabase
      .from('workflows')
      // Not paused_by_plan: the customer did this, and the workflow list must
      // not describe it back to them as something billing did.
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq('customer_id', customerId)
      .in('id', toPause)
      .select('id, name')

    if (pauseError) {
      console.error(`[disconnect] could not pause workflows for ${customerId}:`, pauseError.message)
      return { status: 'failed', stage: 'pause', pausedWorkflows: [] }
    }
    pausedWorkflows = (paused ?? []).map((w) => ({ id: w.id as string, name: w.name as string }))
  }

  // ── 2. Delete our copy ─────────────────────────────────────────────────────
  const { error: deleteError } = await supabase.from(table).delete().eq('customer_id', customerId)
  if (deleteError) {
    console.error(`[disconnect] could not delete ${provider} for ${customerId}:`, deleteError.message)
    return { status: 'failed', stage: 'delete', pausedWorkflows }
  }

  // ── 3. Delete what it left behind ──────────────────────────────────────────
  // Queued work first: a job that runs after its connection is gone dies, and
  // a dead job is reported to the customer as an automation that failed.
  const cleanup: PromiseLike<{ error: { message: string } | null }>[] = []

  if (provider === 'hubspot') {
    // Every workflow starts from HubSpot, so everything queued depends on it.
    cleanup.push(
      supabase
        .from('jobs')
        .delete()
        .eq('customer_id', customerId)
        .eq('status', 'pending')
        .in('kind', ['hubspot.event', 'workflow.action'])
    )
    // The deal changes HubSpot sent us, and the stage we last saw per deal.
    // Without the snapshots, a later reconnect also starts from a clean
    // baseline instead of firing for every change made while disconnected.
    cleanup.push(supabase.from('hubspot_events').delete().eq('customer_id', customerId))
    cleanup.push(supabase.from('deal_snapshots').delete().eq('customer_id', customerId))
  } else if (users.length > 0) {
    cleanup.push(
      supabase
        .from('jobs')
        .delete()
        .eq('customer_id', customerId)
        .eq('status', 'pending')
        .eq('kind', 'workflow.action')
        .in('payload->>workflowId', users.map((w) => w.id as string))
    )
  }

  let cleanupComplete = true
  for (const { error } of await Promise.all(cleanup)) {
    if (error) {
      cleanupComplete = false
      console.error(`[disconnect] ${provider} cleanup incomplete for ${customerId}:`, error.message)
    }
  }

  // ── 4. Revoke at the provider ──────────────────────────────────────────────
  let revocation: Revocation = { outcome: 'unconfirmed', detail: 'credentials could not be decrypted' }
  if (credentials?.provider === 'hubspot') {
    // Uninstalling removes the app from the portal, for every Workliq account
    // connected to it. Only done when this was the last one.
    const { count, error } = await supabase
      .from('hubspot_connections')
      .select('id', { count: 'exact', head: true })
      .eq('hub_id', credentials.hubId)
    revocation = await revokeHubSpot(credentials.refreshToken, {
      uninstall: !error && count === 0,
      customerId,
    })
  } else if (credentials?.provider === 'slack') {
    revocation = await revokeSlack(credentials.accessToken, credentials.webhookUrl, customerId)
  } else if (credentials?.provider === 'notion') {
    revocation = await revokeNotion(credentials.accessToken)
  }

  console.log(
    `[disconnect] ${provider} for ${customerId}: ${revocation.outcome} (${revocation.detail}); ` +
      `paused ${pausedWorkflows.length}; cleanup ${cleanupComplete ? 'complete' : 'INCOMPLETE'}`
  )

  return { status: 'disconnected', revocation, pausedWorkflows, cleanupComplete }
}
