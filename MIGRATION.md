# Deployment runbook — Phase 1 (security foundation)

**The order below is not optional.** Encrypting the database before the code
that can read it is live will break every integration immediately.

Why the order is safe in this direction: `decrypt()` passes non-envelope values
through unchanged, so **new code reads old plaintext rows fine**. The reverse is
not true — old code cannot read an encrypted row at all.

---

## 1. Set `WORKLIQ_ENCRYPTION_KEY` in Vercel

A key has already been generated into your local `.env.local`. Production must
use **the same value**, or it cannot decrypt anything written locally.

Print it (it is not in git — `.env*` is gitignored):

```bash
grep '^WORKLIQ_ENCRYPTION_KEY=' .env.local | cut -d= -f2-
```

Add it in Vercel → Project → Settings → Environment Variables, for
**Production, Preview and Development**.

If you would rather generate your own instead, use `openssl rand -base64 32`
and replace the value in `.env.local` too — the two must match.

> Losing this key means every stored HubSpot, Slack and Notion credential
> becomes permanently unreadable and all three integrations must be reconnected
> by hand. Keep a copy in a password manager.

## 2. Apply the SQL migrations

`006_credential_encryption.sql` and `007_audit_and_rate_limits.sql` have
**already been applied** to the live project (`zzumuphqvzpveivzopry`). They are
in `supabase/migrations/` for the record and for rebuilding the schema from
scratch. Nothing to do unless you are provisioning a new environment.

## 3. Deploy the application

Merge and let Vercel deploy. At this point:

- New credentials are written encrypted.
- Existing plaintext credentials still read fine (passthrough).
- Nothing is broken; the database simply holds a mix.

## 4. Run the backfill — DONE (2026-09-12)

All 5 plaintext credentials across 3 rows were encrypted. Re-running reports
`0 plaintext value(s) found`, and every column now begins `v1:`.

The script stays idempotent, so it is safe to re-run at any time as a check:

```bash
npm run backfill:encryption
```

## 5. Verify the integrations still work

In the dashboard, use the Slack and Notion **test** buttons. Both read a
credential, decrypt it, and call the third-party API — so a success proves the
round trip end to end. For HubSpot, trigger the cron manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://www.workliq.com/api/cron/stale-deals
```

## 6. Close the migration path — DONE (2026-09-12)

`decrypt()` no longer passes plaintext through. Anything that is not a `v1:`
envelope now throws, so a credential that somehow reached the database
unencrypted stops the request rather than being used silently. The error names
the backfill command and deliberately does not include the rejected value,
since that value may itself be a live credential.

**One operational consequence:** if you ever restore an old database backup
taken before 2026-09-12, those rows will be plaintext and every route touching
them will fail loudly. The fix is to re-run the backfill against the restored
data — not to revert this behaviour.

---

## Manual steps that cannot be done from code

- **Enable leaked-password protection**: Supabase → Authentication → Policies.
  Flagged by the security advisor. Low impact here (login is email OTP, not
  passwords) but it costs nothing.

- **Confirm OAuth redirect URIs.** Everything now derives from
  `NEXT_PUBLIC_APP_URL` via `lib/config.ts`, defaulting to
  `https://www.workliq.com`. The registered redirect URI in each provider's app
  settings must match **exactly**:

  | Provider | Redirect URI |
  |---|---|
  | HubSpot | `https://www.workliq.com/api/auth/hubspot/callback` |
  | Slack   | `https://www.workliq.com/api/auth/slack/callback` |
  | Notion  | `https://www.workliq.com/api/auth/notion/callback` |

  Previously HubSpot used `www` while Slack and Notion used the apex domain.
  Because the OAuth state cookie is host-only, a flow that started on one host
  and returned on the other lost the cookie and failed the CSRF check. If your
  provider apps are currently registered against the apex domain, either update
  them to `www` or set `NEXT_PUBLIC_APP_URL=https://workliq.com` — the important
  thing is that all four agree.

- **Add a redirect** from `workliq.com` to `www.workliq.com` (or the reverse) in
  Vercel, so customers cannot land on the non-canonical host mid-flow.

---

# Phase 2 — real-time events and the job queue

## Already applied

`008_job_queue.sql` is live on the project (`zzumuphqvzpveivzopry`): the `jobs`
table with its claim/complete/fail functions, and `hubspot_events`. Additive
only — nothing existing changed behaviour.

## What you need to do in HubSpot

In your HubSpot developer app (the one behind client ID
`399fbd57-9bd1-4d3a-926a-31f18232704f`), open **Webhooks** and set:

| Field | Value |
|---|---|
| Target URL | `https://www.workliq.com/api/webhooks/hubspot` |
| Subscriptions | `deal.creation` and `deal.propertyChange` (property: `dealstage`) |

No new secret is needed — HubSpot signs with the app's **client secret**, which
is already set as `HUBSPOT_CLIENT_SECRET`.

Verify it works: change a deal's stage in HubSpot, then open
**Dashboard → Activity**. The event should appear within seconds.

## The scheduling constraint you should know about

**Vercel's Hobby plan limits cron jobs to once per day** — a sub-daily schedule
fails the deployment outright, it isn't merely throttled. The system is built so
this does not hurt:

- **Real-time delivery needs no cron.** The webhook handler acknowledges HubSpot
  in well under its ~5s budget, then drains the queue in the same invocation
  via `after()`. Latency is seconds.
- **Retries are opportunistic.** Any later webhook drains everything due, not
  just its own work.
- **The daily crons are the floor**, not the mechanism.

The one gap: on an account with no deal activity, a failed delivery could wait
up to a day for its retry. Either of these removes that, with no code change:

- Upgrade to Vercel Pro and set `/api/cron/jobs` to `* * * * *` in `vercel.json`.
- Point any external scheduler at `GET /api/cron/jobs` every minute with
  `Authorization: Bearer $CRON_SECRET`. Free; the endpoint already authenticates.

See `lib/scheduling.md` for the full reasoning.

---

# Phase 3 — AI workflow steps

## Already applied

`009_ai_steps.sql` is live: the `ai_usage` meter, the
`ai_monthly_budget_usd` column on `customers` (default **$5.00**), and the
`ai_spend_this_month` function. Additive only.

## What you need to do

**Add `ANTHROPIC_API_KEY` to Vercel**, for Production, Preview and Development.
Get one from console.anthropic.com. Until it is set, `ai_step` workflows fail
with a clear configuration error and every other action is unaffected.

I could not test the live model calls from here — there was no Anthropic
credential available in this environment. The code is written against the
documented SDK and typechecks, and everything deterministic around it (cost
arithmetic, budget enforcement, the month boundary) is unit-tested and verified
against the database. **The first real call is still unproven.** Create one
`ai_step` workflow, trigger it, and check Dashboard → Activity before relying
on it.

## What it costs

Model is `claude-opus-5` at $5/$25 per million input/output tokens. A deal
summary is roughly 700 tokens in, 150 out — about **$0.0072 per run**, so
roughly 140 runs per dollar.

Every call is metered into `ai_usage` and checked against the customer's
monthly budget *before* it runs, using a worst-case estimate that assumes the
full output allowance. Above the ceiling, AI steps fail closed; nothing else is
affected. To change a customer's limit:

```sql
update customers set ai_monthly_budget_usd = 25.00 where email = '...';
```

Setting it to `0` disables AI steps for that account entirely.

## What is sent to the model

Only four fields, constructed explicitly in `lib/ai.ts` (`DealFacts`):

- deal name
- current stage
- owner name
- what triggered the workflow, and days since last activity

**Never** contact records, email addresses, phone numbers, or note bodies. The
type is deliberately explicit rather than passing a HubSpot object through, so
widening the deal fetch later cannot silently start sending more to a third
party. Worth stating plainly in your privacy policy before you take customers.

---

# Phase 4 — billing and plan limits

## Already applied

`010_billing.sql` is live: `subscriptions`, `stripe_events`, and the
`claim_subscription_for_customer` / `entitlements_for_customer` functions.
Additive only.

## What you need to do

**1. Add the Stripe webhook.** In the Stripe dashboard → Webhooks, add an
endpoint:

| Field | Value |
|---|---|
| Endpoint URL | `https://www.workliq.com/api/webhooks/stripe` |
| Events | `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed` |

**2. Add `STRIPE_WEBHOOK_SECRET` to Vercel** — the `whsec_...` value Stripe
shows when you create that endpoint. It is *not* the same as your API key, and
test-mode and live-mode endpoints have different secrets.

Until it is set, the endpoint returns 500 and Stripe retries, so no event is
lost — it just isn't applied yet.

**3. Note on the Stripe account.** The Stripe account connected to this session
was `liooasis.bigcartel`, which is a different business, so I did not touch it.
Everything above has to be done in the Stripe account that actually owns the
Workliq prices.

## How plans resolve

| Plan | Active workflows | AI budget / month | Webhook actions |
|---|---|---|---|
| Free | 1 | — | No |
| Starter | 10 | $10 | Yes |
| Growth | 50 | $50 | Yes |

Limits live in `lib/plans.ts` — product decisions belong in a reviewable diff,
not in a SQL console. What a *particular customer* is on lives in the database.

Only Stripe's `active` and `trialing` statuses count as paid. `past_due`,
`canceled`, `unpaid` and `incomplete` all fall back to Free — a subscription
that isn't being paid for is not an entitlement. Verified against all six
statuses.

## The ordering problem this solves

Checkout happens *before* sign-up: pricing → Stripe → `/onboarding` → create
account. So the first billing webhook arrives when no customer row exists yet,
and `customers.id` is a foreign key to `auth.users` so no placeholder can be
invented.

`subscriptions` is therefore keyed on **email**, and linked to a customer when
that person signs in. Matching is case-insensitive — someone paying as
`Name@Co.com` and signing up as `name@co.com` must resolve to the same account,
or they pay and stay on Free.

## To change one customer's limits by hand

```sql
update customers set ai_monthly_budget_usd = 25.00 where email = '...';
```

A hand-set budget is left alone by later billing webhooks — it only resets if
the current value still matches a plan default. Overwriting a deliberate
override on the next invoice would be a baffling bug to diagnose.


---

# Plan resolution from Stripe price IDs (2026-09-12)

`lib/plans.ts` now maps Stripe price IDs to plans, built from the same four
`STRIPE_PRICE_*` variables the checkout route charges against — so the mapping
cannot drift from what customers are actually billed.

**Why this was needed.** The plan used to come only from
`subscription.metadata.plan`, which the checkout route writes once. Two ways
that goes wrong, both ending with someone paying for the wrong thing:

- A customer upgrading Starter → Growth in Stripe's **Billing Portal** changes
  the *price*. The metadata does not change. They would pay for Growth and keep
  Starter's limits.
- A subscription created in the Stripe dashboard, from a payment link, or
  migrated in has no metadata at all → resolved to Free.

**Precedence:** price ID first, metadata as fallback. An unrecognised price logs
an error naming the price and telling you to check `STRIPE_PRICE_*` — it is
never silently treated as Free.

Verified end to end: a `customer.subscription.updated` carrying a Growth annual
price with stale `starter/monthly` metadata correctly resolved to
`growth/annual`.

**When you create the live prices,** update all four `STRIPE_PRICE_*` variables
in Vercel. If they don't match the account the subscriptions are bought in,
every subscription logs the unrecognised-price error and falls back to metadata
— which still works for checkout-created subscriptions, but silently loses
Billing Portal upgrades.
