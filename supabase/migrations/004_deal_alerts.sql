-- Run this in the Supabase SQL editor after 003_notion_connections.sql.

-- ─── customers: add staleness threshold ──────────────────────────────────────
-- Each customer sets how many days of inactivity counts as "stale".
-- Options exposed in the UI: 3 / 7 / 14 / 30 (matches the Notion Threshold
-- select options). Defaults to 14 if not yet configured.

alter table customers
  add column if not exists stale_threshold_days integer not null default 14;

-- ─── deal_alerts ─────────────────────────────────────────────────────────────
-- Tracks which deals have already been flagged, per customer, per threshold.
-- The unique constraint on (customer_id, deal_id, threshold) is intentional:
--   • If a customer changes their threshold from 7 to 14, a deal that was
--     already flagged at 7 days gets a fresh alert at 14 days — these are
--     distinct events, not duplicates.
--   • If a cron run crashes mid-way, the next run re-attempts only the
--     channels that weren't successfully notified (slack_notified / notion_logged
--     still false) without re-firing channels that already succeeded.

create table if not exists deal_alerts (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references customers(id) on delete cascade,
  deal_id          text not null,       -- HubSpot deal ID
  threshold        integer not null,    -- days, matches customer.stale_threshold_days at alert time
  slack_notified   boolean not null default false,
  notion_logged    boolean not null default false,
  created_at       timestamptz default now() not null,

  unique (customer_id, deal_id, threshold)
);

create index if not exists deal_alerts_customer_idx on deal_alerts(customer_id);

-- Only the service role (server-side / cron) reads/writes this table.
alter table deal_alerts enable row level security;
