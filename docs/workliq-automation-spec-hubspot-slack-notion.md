# Workliq Automation Spec: HubSpot → Slack + Notion Stale-Deal Pipeline

This extends Phases 3–4 of `workliq-mvp-build-plan.md` to add Notion as a second
output channel alongside Slack, and upgrades Slack from a manual webhook-paste
field to a full "Add to Slack" OAuth connection. Every stale deal gets **both**
a Slack alert **and** a logged row in a Notion database — both connected by
the customer themselves via OAuth.

---

## 1. High-Level Flow

```
[Vercel Cron, every few hours]
        │
        ▼
For each connected customer:
        │
        ▼
Fetch their HubSpot deals (via stored OAuth token)
        │
        ▼
For each deal past their staleness threshold:
        │
        ├─ Already in deal_alerts for this deal+threshold? → skip
        │
        └─ Not yet alerted:
                ├─ Post Slack message (if Slack connected)
                ├─ Create Notion database row (if Notion connected)
                └─ Insert record into deal_alerts
```

Both outputs are independent — a customer can have Slack only, Notion only,
both, or (during onboarding) neither yet. Nothing blocks on the other.

---

## 2. New Manual Setup Step: Notion Integration

Same shape as the HubSpot app you just created, but on Notion's developer side.

1. Go to **[notion.so/my-integrations](https://www.notion.so/my-integrations)**
2. Click **New integration**
3. Choose **Public integration** (this is the one that supports OAuth — a
   private/internal integration only works inside your own workspace, not
   customers')
4. Fill in name (`Workliq`), logo, and the redirect URI:
   `https://workliq.com/api/auth/notion/callback`
5. Request these **capabilities**: `Read content`, `Insert content`,
   `Update content` (needed to create/update rows in the customer's database)
6. Save, then copy the **OAuth client ID** and **OAuth client secret** from
   the integration's settings page — same handling rule as HubSpot: secret
   goes into env vars, never into chat.

Note: Notion will show installing users a "not verified" notice unless you
submit the integration for Notion's verification review. That's fine for
now — verification only matters if you want it discoverable in Notion's
public integration directory, not for the OAuth flow to function.

---

## 3. Data Model Additions

### `notion_connections` table (new — parallels `hubspot_connections`)

| Column            | Type      | Notes                                      |
|--------------------|-----------|---------------------------------------------|
| `id`               | uuid (PK) |                                              |
| `customer_id`      | uuid (FK) | references `customers`                      |
| `access_token`     | text      | encrypted at rest, server-side only         |
| `workspace_id`     | text      | Notion workspace the token is scoped to     |
| `workspace_name`   | text      | for display on dashboard ("Connected to X") |
| `database_id`      | text      | the auto-created database's ID              |
| `parent_page_id`   | text      | the page the customer granted access to     |
| `created_at`       | timestamp |                                              |
| `updated_at`       | timestamp |                                              |

Notion access tokens from the standard OAuth flow don't expire (no refresh
token needed) — simpler than HubSpot's token refresh handling.

### `slack_connections` table (upgraded — was webhook-URL-only, now OAuth)

| Column            | Type      | Notes                                      |
|--------------------|-----------|---------------------------------------------|
| `id`               | uuid (PK) |                                              |
| `customer_id`      | uuid (FK) | references `customers`                      |
| `access_token`     | text      | encrypted at rest, server-side only         |
| `webhook_url`      | text      | from the OAuth response's `incoming_webhook.url` |
| `channel_name`     | text      | channel the customer picked during OAuth    |
| `team_id`          | text      | Slack workspace/team ID the token is scoped to |
| `team_name`        | text      | for display on dashboard ("Connected to X") |
| `created_at`       | timestamp |                                              |
| `updated_at`       | timestamp |                                              |

Slack access tokens from this flow don't expire — no refresh logic needed,
same as Notion.

### `deal_alerts` table (already in Phase 4 — needs one addition)

Add a column to record *which* channels were successfully notified, so a
partial failure (e.g. Slack succeeds, Notion API call fails) can be retried
for just the failed channel rather than re-sending both:

| Column              | Type    | Notes                                  |
|----------------------|---------|------------------------------------------|
| `slack_notified`     | boolean | default false                            |
| `notion_logged`      | boolean | default false                            |

---

## 4. Dashboard Changes

Add a third connection card alongside "Connect HubSpot" / "Connect Slack
alerts":

**"Connect Notion"**
1. Customer clicks **Connect Notion** → redirected through Notion's OAuth
   consent screen → back to dashboard
2. After connecting, customer must **pick which database** to log into.
   Two reasonable approaches — pick one:
   - **(A) Customer picks an existing database** — query
     `GET /v1/search` (filtered to `object: "database"`) using their token,
     show a dropdown of database titles, store the chosen `database_id`.
   - **(B) Workliq auto-creates a database** — on connect, create a new
     database in their workspace (under a page they grant access to) with a
     pre-built schema (see §5). Simpler for the customer — no setup, just
     grant page access and Workliq does the rest.

   **Recommendation: (B).** It removes a setup step for the customer and
   guarantees the schema always matches what the cron job expects to write
   — with (A), a customer could pick a database missing required columns
   and every write would fail silently or error.

3. Show "send test row" button (mirrors the Slack "send test message"
   button from Phase 3) so they can confirm it works immediately.

---

## 5. Notion Database Schema (auto-created, option B)

| Property name     | Type        | Notes                                    |
|--------------------|-------------|---------------------------------------------|
| Deal Name          | Title       | from HubSpot deal name                      |
| Stage              | Select      | HubSpot deal stage at time of flagging      |
| Owner              | Text        | HubSpot deal owner name                     |
| Days Stale         | Number      | days since last activity                    |
| Threshold          | Select      | 3 / 7 / 14 / 30 (matches dashboard setting)  |
| Flagged On         | Date        | when Workliq logged it                      |
| HubSpot Link       | URL         | direct link to the deal in HubSpot          |
| Status             | Select      | "New" / "Acknowledged" / "Resolved" — lets the customer manually triage inside Notion |

"Status" is the one field Workliq never writes after creation — it exists
purely for the customer's own use, so they have somewhere to mark progress
without it ever getting overwritten by the next cron run.

---

## 6. Cron Job Logic (extends Phase 4)

Pseudocode for the per-deal branch inside the existing scheduled job:

```
if deal.days_since_activity >= customer.threshold:
    existing_alert = find deal_alerts row for (deal_id, threshold)

    if existing_alert is None:
        existing_alert = create deal_alerts row (slack_notified=false, notion_logged=false)

    if not existing_alert.slack_notified and customer.slack_connection exists:
        try: post to customer's Slack webhook URL
             mark slack_notified = true
        except: log error, leave false for retry next run

    if not existing_alert.notion_logged and customer.notion_connection exists:
        try: create row in customer's Notion database via Notion API
             mark notion_logged = true
        except: log error, leave false for retry next run
```

This means a transient API failure on one channel doesn't block the other,
and doesn't cause a duplicate alert on the next run — only the channel that
actually failed gets retried.

---

## 7. Auth/Token Handling Summary

| Service   | Token type           | Refresh needed?        | Storage                          |
|-----------|------------------------|--------------------------|------------------------------------|
| HubSpot   | OAuth access + refresh | Yes — access token expires | `hubspot_connections`, server-side only |
| Slack     | OAuth access token     | No — doesn't expire       | `slack_connections`, server-side only   |
| Notion    | OAuth access token     | No — doesn't expire       | `notion_connections`, server-side only  |

None of these tokens should ever be sent to the client/browser — same rule
as HubSpot in the original plan.

---

## 8. Suggested Phase Renumbering

To slot this into the existing build plan without renumbering everything:

- **Phase 3a:** Slack alerts (unchanged from original plan)
- **Phase 3b:** Notion connection + auto-created tracking database (this doc)
- **Phase 4:** Stale-deal checker — now writes to whichever of Slack/Notion
  the customer has connected, per §6 above

---

## 9. Decisions (previously open questions — now resolved)

- **Auto-create vs. customer-selected database:** Resolved — auto-create
  (option B). Removes a setup step and guarantees schema correctness.
- **Notion → Workliq sync:** Resolved — none for MVP. Notion is a one-way
  log; "Status" changes the customer makes in Notion are never read back
  by Workliq or reflected in Slack.
- **Where the auto-created database lives:** Resolved — under a page the
  customer explicitly grants access to during the OAuth connect step (not
  the workspace root).
- **Slack connection method:** Resolved — upgraded from manual webhook-URL
  paste to a full "Add to Slack" OAuth flow. Customer picks their channel
  natively in Slack's consent screen rather than generating and pasting a
  URL themselves. See `claude-code-brief-hubspot-slack-notion.md` §2 for
  the full flow.
