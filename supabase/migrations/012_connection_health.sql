-- Run this in the Supabase SQL editor after 011_workflow_runs_drift_repair.sql.

-- ─── Connection health ────────────────────────────────────────────────────────
-- Until now a connection was binary: the row exists or it doesn't. There was no
-- way to represent the state that actually ends the product for a customer —
-- present but no longer usable.
--
-- That state is not hypothetical. A HubSpot refresh token is invalidated the
-- moment someone uninstalls the app from the portal; HubSpot then answers every
-- refresh with 400 invalid_grant / BAD_REFRESH_TOKEN, forever. A Slack incoming
-- webhook dies when the app is removed or its channel is archived. A Notion
-- token dies when the integration's access is revoked, and the database it
-- writes to can simply be deleted.
--
-- In every one of those cases the old behaviour was the same: each workflow run
-- threw a generic error, the queue treated it as transient, burned all five
-- attempts against a credential that will never work again, and dead-lettered
-- the job. Nothing was written down about the connection itself, so the next
-- run repeated the whole cycle, and the customer was told nothing at all.
--
-- These four columns are what makes "broken" representable, which is the
-- precondition for both halves of the fix: stopping the pointless retries, and
-- being able to tell the customer which connection to reconnect.

-- ─── Why `add column if not exists` and a dropped constraint ──────────────────
-- 011 recorded the cost of assuming a migration file describes the live schema.
-- `add column if not exists` is idempotent in the safe direction — it adds what
-- is missing and leaves what exists alone. The check constraints are dropped
-- before being added because `add constraint` has no IF NOT EXISTS form, so
-- re-running this file without the drop would fail on the second pass.

-- status
--   'active'       — last use succeeded, or it has not failed since connecting.
--   'needs_reauth' — the credential is dead. Only the customer can fix this, by
--                    reconnecting. Nothing we retry will help.
--
-- Deliberately two states, not three. A separate 'revoked' would be a
-- distinction no code acts on differently: every non-active state routes to the
-- same place, which is asking the customer to reconnect.

alter table hubspot_connections add column if not exists status           text not null default 'active';
alter table hubspot_connections add column if not exists last_error       text;
alter table hubspot_connections add column if not exists last_error_at    timestamptz;
alter table hubspot_connections add column if not exists last_success_at  timestamptz;

alter table slack_connections   add column if not exists status           text not null default 'active';
alter table slack_connections   add column if not exists last_error       text;
alter table slack_connections   add column if not exists last_error_at    timestamptz;
alter table slack_connections   add column if not exists last_success_at  timestamptz;

alter table notion_connections  add column if not exists status           text not null default 'active';
alter table notion_connections  add column if not exists last_error       text;
alter table notion_connections  add column if not exists last_error_at    timestamptz;
alter table notion_connections  add column if not exists last_success_at  timestamptz;

alter table hubspot_connections drop constraint if exists hubspot_connections_status_check;
alter table hubspot_connections add  constraint hubspot_connections_status_check
  check (status in ('active', 'needs_reauth'));

alter table slack_connections   drop constraint if exists slack_connections_status_check;
alter table slack_connections   add  constraint slack_connections_status_check
  check (status in ('active', 'needs_reauth'));

alter table notion_connections  drop constraint if exists notion_connections_status_check;
alter table notion_connections  add  constraint notion_connections_status_check
  check (status in ('active', 'needs_reauth'));

-- ─── Indexes ──────────────────────────────────────────────────────────────────
-- The per-customer lookup ("is this customer's Slack broken?") is already served
-- by the existing unique(customer_id) index — there is exactly one row per
-- customer per provider, so no new index helps it.
--
-- The genuinely new access pattern is the opposite direction: find every broken
-- connection across all customers, for the notification sweep. Partial, so the
-- index contains only the rows that are actually broken and stays near-empty
-- when the product is healthy. Ordered by last_error_at so the sweep can read
-- "what broke since I last ran" directly off the index.

create index if not exists hubspot_connections_unhealthy_idx
  on hubspot_connections (last_error_at desc) where status <> 'active';

create index if not exists slack_connections_unhealthy_idx
  on slack_connections   (last_error_at desc) where status <> 'active';

create index if not exists notion_connections_unhealthy_idx
  on notion_connections  (last_error_at desc) where status <> 'active';

-- ─── A note on the backfill ───────────────────────────────────────────────────
-- Existing rows get status 'active' and a null last_success_at. Null here means
-- "nothing recorded since health tracking existed", NOT "never worked" — every
-- connection predating this migration has no history to import. The first
-- successful action on each connection fills it in.
--
-- Starting everyone at 'active' rather than probing each credential is the
-- deliberate choice: a false 'needs_reauth' emails a customer to fix something
-- that is not broken, which costs more trust than a day's delay in noticing a
-- connection that genuinely is.
