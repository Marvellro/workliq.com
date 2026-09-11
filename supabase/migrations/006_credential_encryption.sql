-- Run this in the Supabase SQL editor after 005_workflows.sql.

-- ─── Credential encryption ────────────────────────────────────────────────────
-- The access_token / refresh_token / webhook_url columns in hubspot_connections,
-- slack_connections and notion_connections now hold AES-256-GCM envelopes
-- produced by lib/crypto.ts, in the form:
--
--     v1:<iv-base64>:<auth-tag-base64>:<ciphertext-base64>
--
-- They remain `text`, which is unbounded in Postgres, so no column widening is
-- required — an envelope is roughly 1.4x the plaintext length plus ~60 bytes.
--
-- The key version is carried in the value's own `v<n>:` prefix rather than in a
-- separate column, so a key rotation does not need a schema change and rows
-- encrypted under different keys can coexist while a backfill runs.
--
-- This supersedes the "TODO: move to Supabase Vault" notes in 001–003. Vault
-- was rejected deliberately: it decrypts for anyone holding database
-- credentials, so a leaked service-role key would still yield plaintext tokens.
-- Encrypting in the application means the database is inert without
-- WORKLIQ_ENCRYPTION_KEY, which Postgres never sees.
--
-- Existing rows are migrated by scripts/backfill-encryption.ts, not by this
-- file: the key lives in the application environment, so re-encryption cannot
-- happen inside SQL.

-- ─── customers: outbound webhook signing secret ──────────────────────────────
-- Per-customer secret used to sign `webhook` workflow deliveries
-- (X-Workliq-Signature). Per-customer rather than global so that one customer
-- cannot use their own secret to forge a payload to another's endpoint, and so
-- a single customer's secret can be rotated in isolation.
--
-- Nullable: it is generated on first use by lib/workflow-actions.ts, so
-- existing customers don't need backfilling and customers who never configure
-- a webhook action never get one.

alter table customers
  add column if not exists webhook_secret text;

comment on column customers.webhook_secret is
  'HMAC-SHA256 secret for signing outbound webhook deliveries. Generated on first webhook use.';
