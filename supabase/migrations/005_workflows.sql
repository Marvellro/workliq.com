-- Run this in the Supabase SQL editor after 004_deal_alerts.sql.

-- ─── workflows ─────────────────────────────────────────────────────────────────
-- Customer-defined automations: "when <trigger>, if <condition>, then <action>".
-- v1 supports HubSpot-deal triggers only, reusing the read-only deal access we
-- already have. Conditions are optional and limited to a single property check
-- to keep the builder UI a simple form rather than a rule engine.
--
-- trigger_config shape depends on trigger_type:
--   deal_stage_changed → { "to_stage": "closedwon" }   (to_stage omitted = any change)
--   deal_created        → {}
--   deal_stale           → { "threshold_days": 7 }
--
-- action_config shape depends on action_type:
--   slack_message → { "message_template": "..." }       (omitted = default template)
--   notion_row     → {}                                  (writes to the customer's connected database)
--   webhook        → { "url": "https://..." }

create table if not exists workflows (
  id                  uuid primary key default gen_random_uuid(),
  customer_id         uuid not null references customers(id) on delete cascade,
  name                text not null,

  trigger_type        text not null check (trigger_type in ('deal_stage_changed', 'deal_created', 'deal_stale')),
  trigger_config       jsonb not null default '{}'::jsonb,

  -- Optional single condition, e.g. "hubspot_owner_id equals 12345".
  -- Both null = no condition, workflow always fires on trigger match.
  condition_property  text,
  condition_operator  text check (condition_operator in ('equals', 'not_equals', 'contains')),
  condition_value     text,

  action_type         text not null check (action_type in ('slack_message', 'notion_row', 'webhook')),
  action_config        jsonb not null default '{}'::jsonb,

  enabled             boolean not null default true,
  created_at          timestamptz default now() not null,
  updated_at          timestamptz default now() not null
);

create index if not exists workflows_customer_idx on workflows(customer_id);
create index if not exists workflows_customer_enabled_idx on workflows(customer_id) where enabled = true;

alter table workflows enable row level security;

create policy "Customers can read their own workflows"
  on workflows for select
  using (auth.uid() = customer_id);

-- All writes from the app go through the service role key (bypasses RLS via
-- getCustomerSession + explicit customer_id checks in the API routes), so this
-- select policy protects direct API access only, matching the pattern used by
-- the `customers` table in 001.

-- ─── deal_snapshots ──────────────────────────────────────────────────────────
-- Tracks the last-known stage per deal, per customer, so the workflow engine
-- can detect "created" (no prior row) and "stage changed" (stage differs from
-- last run) across cron invocations. The stale-deals cron doesn't need this —
-- staleness is computed fresh each run from notes_last_updated — but
-- create/change events are inherently about the *transition*, which requires
-- remembering what we saw last time.

create table if not exists deal_snapshots (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references customers(id) on delete cascade,
  deal_id        text not null,
  last_stage     text,
  first_seen_at  timestamptz default now() not null,
  updated_at     timestamptz default now() not null,

  unique (customer_id, deal_id)
);

create index if not exists deal_snapshots_customer_idx on deal_snapshots(customer_id);

alter table deal_snapshots enable row level security;

-- ─── workflow_runs ───────────────────────────────────────────────────────────
-- Dedup + audit ledger, generalizing the pattern from deal_alerts (004) to
-- cover arbitrary trigger/action combinations instead of just Slack+Notion.
--
-- trigger_fingerprint uniquely identifies the *event* that caused a workflow to
-- fire, so re-running the cron doesn't refire the same event twice:
--   deal_created         → deal_id
--   deal_stage_changed   → deal_id + ':' + new_stage
--   deal_stale            → deal_id + ':' + threshold_days
--
-- Unlike deal_alerts (which tracks per-channel booleans on one shared row
-- because every stale deal always tries both Slack and Notion), each workflow
-- here has exactly one action, so a single success/failed row per
-- (workflow, deal, event) is sufficient and simpler.
--
-- status defaults to 'pending' so the engine can claim a row via upsert
-- *before* executing the action (mirroring deal_alerts' claim-first pattern):
-- the claiming upsert only sends the conflict-key columns, so on conflict
-- Postgres leaves the existing status untouched instead of resetting it.

create table if not exists workflow_runs (
  id                   uuid primary key default gen_random_uuid(),
  workflow_id          uuid not null references workflows(id) on delete cascade,
  customer_id          uuid not null references customers(id) on delete cascade,
  deal_id              text not null,
  trigger_fingerprint  text not null,
  status               text not null default 'pending' check (status in ('pending', 'success', 'failed')),
  error_message        text,
  fired_at             timestamptz default now() not null,

  unique (workflow_id, deal_id, trigger_fingerprint)
);

create index if not exists workflow_runs_workflow_idx on workflow_runs(workflow_id);
create index if not exists workflow_runs_customer_idx on workflow_runs(customer_id);

alter table workflow_runs enable row level security;

create policy "Customers can read their own workflow runs"
  on workflow_runs for select
  using (auth.uid() = customer_id);
