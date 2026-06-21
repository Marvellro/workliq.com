-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Requires the pgcrypto extension for gen_random_uuid(), which Supabase enables by default.

-- ─── customers ────────────────────────────────────────────────────────────────
-- One row per paying customer. id mirrors auth.users so we can join without a
-- separate FK resolution step. email is denormalised here for convenience (e.g.
-- display in admin, cron job logs) — the source of truth is auth.users.email.
--
-- TODO: Once Supabase Vault is enabled for this project, move access_token /
-- refresh_token columns in the *_connections tables to Vault secrets and store
-- only the secret reference here. See: https://supabase.com/docs/guides/database/vault

create table if not exists customers (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  plan       text,
  created_at timestamptz default now() not null
);

-- Prevent duplicate rows if the upsert fires more than once during onboarding.
create unique index if not exists customers_email_idx on customers(email);

-- RLS: customers can only read/update their own row. All writes from the app
-- use the service role key (bypasses RLS), so these policies protect direct
-- API access only.
alter table customers enable row level security;

create policy "Customers can read their own row"
  on customers for select
  using (auth.uid() = id);

create policy "Customers can update their own row"
  on customers for update
  using (auth.uid() = id);

-- ─── hubspot_connections ──────────────────────────────────────────────────────
-- Stores one HubSpot OAuth connection per customer. One customer ↔ one HubSpot
-- portal (hub_id). Reconnecting via the UI upserts and overwrites the old tokens.
--
-- TODO: encrypt access_token and refresh_token columns via Supabase Vault once
-- enabled. Volume-level encryption is the current at-rest protection.

create table if not exists hubspot_connections (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references customers(id) on delete cascade,
  access_token   text not null,
  refresh_token  text not null,
  expires_at     timestamptz not null,
  hub_id         text not null,
  created_at     timestamptz default now() not null,
  updated_at     timestamptz default now() not null,

  -- One connection per customer; reconnecting replaces the old row via upsert.
  unique (customer_id)
);

-- Only the service role (server-side) reads/writes this table. No public access.
alter table hubspot_connections enable row level security;
