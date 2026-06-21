-- Run this in the Supabase SQL editor after 002_slack_connections.sql.

-- ─── notion_connections ───────────────────────────────────────────────────────
-- Stores one Notion OAuth connection per customer.
-- database_id is the auto-created "Workliq Stale Deals" database; this is
-- what the cron job writes rows into. parent_page_id is the page the customer
-- granted access to during the OAuth consent screen — stored so we can show
-- the customer where the database was created.
--
-- Notion access tokens do not expire — no refresh_token or expires_at needed.
--
-- TODO: encrypt access_token via Supabase Vault once enabled.
-- Volume-level encryption is the current at-rest protection.

create table if not exists notion_connections (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references customers(id) on delete cascade,
  access_token    text not null,
  workspace_id    text not null,
  workspace_name  text not null,   -- shown on dashboard: "Connected to Acme Corp"
  database_id     text not null,   -- the auto-created database the cron job writes to
  parent_page_id  text not null,   -- the page the customer granted access to
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null,

  unique (customer_id)
);

-- Only the service role (server-side) reads/writes this table.
alter table notion_connections enable row level security;
