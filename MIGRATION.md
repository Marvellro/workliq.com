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

## 4. Run the backfill

Dry run first — it writes nothing and round-trip-verifies every value before it
would touch anything:

```bash
npm run backfill:encryption
```

Expected output today: 5 plaintext values across 3 rows (1 HubSpot, 1 Slack,
1 Notion). Then apply:

```bash
npm run backfill:encryption -- --apply
```

## 5. Verify the integrations still work

In the dashboard, use the Slack and Notion **test** buttons. Both read a
credential, decrypt it, and call the third-party API — so a success proves the
round trip end to end. For HubSpot, trigger the cron manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://www.workliq.com/api/cron/stale-deals
```

## 6. Close the migration path

Once step 4 reports **0 plaintext values**, the legacy passthrough in
`lib/crypto.ts` `decrypt()` should become a hard failure:

```ts
const match = ENVELOPE_RE.exec(stored)
if (!match) throw new Error('Expected an encryption envelope, got plaintext')
```

Until that change lands, a row somehow written as plaintext would be used
silently instead of raising an alarm.

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
