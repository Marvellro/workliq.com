# Claude Code Brief: HubSpot OAuth + Slack Alerts + Notion Logging

This brief covers Phase 2 (HubSpot), Phase 3a (Slack), Phase 3b (Notion), and
Phase 4 (the stale-deal checker that ties them together) from
`workliq-mvp-build-plan.md` and `workliq-automation-spec-hubspot-slack-notion.md`.

All credentials below are already created and live. Client secrets are in
Vercel env vars — do not hardcode them anywhere.

**Build quality expectations:** treat this as production code, not a
prototype. That means: proper error handling and logging on every external
API call (HubSpot, Slack, Notion), input validation on anything user-facing,
clear separation between server-side token handling and client-facing code,
meaningful commit messages, and comments explaining *why* on any non-obvious
logic (especially the dedup/retry logic in the cron job). If a tradeoff or
assumption isn't covered in this brief, flag it for review rather than
guessing silently.

---

## Credentials Already Set Up

**HubSpot** (developer account: `workliq`, app: `Workliq`)
- Client ID: `399fbd57-9bd1-4d3a-926a-31f18232704f`
- Client secret: in Vercel env var `HUBSPOT_CLIENT_SECRET`
- Redirect URL: `https://workliq.com/api/auth/hubspot/callback`
- Scopes: `oauth`, `crm.objects.deals.read`
- Distribution: Marketplace (multi-account OAuth install)
- Token endpoint: `https://api.hubapi.com/oauth/v1/token`

**Notion** (connection: `Workliq`)
- Client ID: `386d872b-594c-8162-84f2-00370d6f32cc`
- Client secret: in Vercel env var `NOTION_CLIENT_SECRET`
- Redirect URL: `https://workliq.com/api/auth/notion/callback`
- Capabilities: Read content, Insert content, Update content (no comments, no user info)
- Auth type: OAuth 2.0, installable in any workspace
- Token endpoint: `https://api.notion.com/v1/oauth/token`
- Notion access tokens do not expire — no refresh logic needed.

**Slack** (app: `Workliq`, App ID: `A0BCXBQLR6C`)
- Client ID: `1139561584631.11439398705216`
- Client secret: in Vercel env var `SLACK_CLIENT_SECRET`
- Redirect URL: `https://workliq.com/api/auth/slack/callback`
- Bot Token Scope: `incoming-webhook`
- Token endpoint: `https://slack.com/api/oauth.v2.access`
- Slack access tokens do not expire — no refresh logic needed.

---

## 1. HubSpot OAuth Connection

**Dashboard UI:** "Connect HubSpot" button/card.

**Flow:**
1. Customer clicks Connect → redirect to HubSpot's OAuth authorize URL with
   `client_id`, `redirect_uri`, and `scope=oauth crm.objects.deals.read`
2. HubSpot redirects back to `/api/auth/hubspot/callback?code=...`
3. Exchange `code` for `access_token` + `refresh_token` via the token endpoint
4. Store both tokens server-side in a `hubspot_connections` table
   (customer_id, access_token, refresh_token, expires_at, hub_id, created_at,
   updated_at) — encrypted at rest, never sent to the client
5. Show "Connected" state on dashboard, with the connected HubSpot account
   name/hub_id for the customer's confirmation

**Token refresh:** HubSpot access tokens expire (~30 min). Build a refresh
helper that checks `expires_at` before each API call and refreshes via
`grant_type=refresh_token` if needed, updating the stored tokens.

---

## 2. Slack OAuth Connection ("Add to Slack")

**Dashboard UI:** "Connect Slack" button/card (upgraded from a manual
webhook-paste field — customer now clicks a button and picks their channel
in Slack's native UI, instead of generating and pasting a URL themselves).

**Flow:**
1. Customer clicks Connect → redirect to Slack's OAuth authorize URL
   (`https://slack.com/oauth/v2/authorize`) with `client_id`,
   `redirect_uri`, and `scope=incoming-webhook`
2. As part of Slack's consent screen, the customer picks **which channel**
   the webhook should post to (this is built into Slack's OAuth UX for the
   `incoming-webhook` scope — we don't need to build a channel-picker)
3. Slack redirects back to `/api/auth/slack/callback?code=...`
4. Exchange `code` for an access token via the token endpoint. The response
   includes an `incoming_webhook.url` field — **that URL is what gets used
   to post alerts**, same as the old manual-paste design, just acquired via
   OAuth instead of the customer copying it themselves
5. Store in `slack_connections` table (customer_id, access_token,
   webhook_url, channel_name, team_id, team_name, created_at, updated_at)
   — server-side only
6. Show "Connected to #[channel name] in [workspace name]" on dashboard
7. "Send test message" button posts a simple confirmation message
   ("✅ Workliq is connected to this channel") to confirm it works
   immediately

No token refresh needed — Slack tokens from this flow don't expire.

---

## 3. Notion OAuth Connection + Auto-Created Database

**Dashboard UI:** "Connect Notion" card.

**Flow:**
1. Customer clicks Connect → redirect to Notion's OAuth authorize URL with
   `client_id` and `redirect_uri`
2. As part of Notion's OAuth consent screen, the customer selects/grants
   access to **a specific page** in their workspace (this is built into
   Notion's OAuth UX — the customer picks the page during authorization,
   we don't need to build a page-picker ourselves)
3. Notion redirects back to `/api/auth/notion/callback?code=...`
4. Exchange `code` for an access token (no refresh token — Notion tokens
   don't expire) via the token endpoint
5. **Immediately after connecting**, auto-create a database under the
   page the customer granted access to, with this schema:

   | Property name | Type   |
   |----------------|--------|
   | Deal Name      | Title  |
   | Stage          | Select |
   | Owner          | Text   |
   | Days Stale     | Number |
   | Threshold      | Select (3/7/14/30) |
   | Flagged On     | Date   |
   | HubSpot Link   | URL    |
   | Status         | Select ("New" / "Acknowledged" / "Resolved") |

6. Store the connection in `notion_connections` table (customer_id,
   access_token, workspace_id, workspace_name, database_id, parent_page_id,
   created_at, updated_at)
7. Show "Connected to [workspace name]" on dashboard
8. "Send test row" button creates one sample row in the new database so the
   customer can confirm it worked immediately

**Important:** Workliq only ever writes to the `Status` field at creation
time (defaults to "New"). It never overwrites `Status` on subsequent runs —
that field belongs to the customer for their own triage, and must stay
untouched after the row is created. This is intentional per the one-way
design decision below.

---

## 4. The Stale-Deal Checker (Vercel Cron)

**Schedule:** every few hours, configured via `vercel.json`.

**`deal_alerts` table** (tracks what's already been flagged, avoids repeats):

| Column           | Type      | Notes                                |
|-------------------|-----------|----------------------------------------|
| `id`              | uuid (PK) |                                          |
| `customer_id`     | uuid (FK) |                                          |
| `deal_id`         | text      | HubSpot deal ID                         |
| `threshold`       | int       | days, matches customer's setting        |
| `slack_notified`  | boolean   | default false                           |
| `notion_logged`   | boolean   | default false                           |
| `created_at`      | timestamp |                                          |

**Per-customer logic:**

```
for each connected customer:
    refresh HubSpot token if needed
    fetch their deals via HubSpot API
    for each deal:
        if days_since_activity >= customer.threshold:
            alert = find or create deal_alerts row (deal_id, threshold)

            if not alert.slack_notified and customer has slack_connection:
                try: POST to customer's slack_connection.webhook_url with deal summary
                     set slack_notified = true
                catch: log error, leave false (retried next run)

            if not alert.notion_logged and customer has notion_connection:
                try: create a page/row in customer's Notion database
                     with Deal Name, Stage, Owner, Days Stale, Threshold,
                     Flagged On (today), HubSpot Link, Status="New"
                     set notion_logged = true
                catch: log error, leave false (retried next run)
```

Both channels are independent — a failure or absence of one never blocks or
duplicates the other. This is a **one-way pipeline**: nothing written by the
customer in Notion (e.g. changing Status to "Resolved") is ever read back
by Workliq. That's an intentional MVP scope decision, not a missing feature
— don't build any Notion → Workliq sync.

---

## 5. Things to Explicitly Avoid

- Don't ever send HubSpot/Notion access tokens or Slack webhook URLs to the
  client/browser — all API calls happen server-side.
- Don't write back to the Notion `Status` field after row creation.
- Don't build a "pick an existing database" flow for Notion — always
  auto-create, per the design decision above.
- Don't build Notion → Workliq sync of any kind for this phase.
