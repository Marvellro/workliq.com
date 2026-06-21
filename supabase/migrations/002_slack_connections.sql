-- Run this in the Supabase SQL editor after 001_customer_auth_and_hubspot.sql.

-- ─── slack_connections ────────────────────────────────────────────────────────
-- Stores one Slack OAuth connection per customer.
-- webhook_url is the key operational field — it's the URL the cron job POSTs
-- alert messages to. The access_token is kept for completeness but the
-- incoming-webhook scope only grants webhook posting rights, so it doesn't
-- need to be used for anything beyond initial connection setup.
--
-- TODO: encrypt access_token and webhook_url via Supabase Vault once enabled.
-- Volume-level encryption is the current at-rest protection.

create table if not exists slack_connections (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references customers(id) on delete cascade,
  access_token text not null,
  webhook_url  text not null,
  channel_name text not null,   -- e.g. "#deal-alerts" — shown on dashboard
  team_id      text not null,
  team_name    text not null,   -- e.g. "Acme Corp" — shown on dashboard
  created_at   timestamptz default now() not null,
  updated_at   timestamptz default now() not null,

  unique (customer_id)
);

-- Only the service role (server-side) reads/writes this table.
alter table slack_connections enable row level security;
