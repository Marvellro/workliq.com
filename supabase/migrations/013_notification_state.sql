-- Run this in the Supabase SQL editor after 012_connection_health.sql.

-- ─── Notification state ───────────────────────────────────────────────────────
-- 012 made "this connection is broken" representable. This records the separate
-- question of whether the customer has been *told*.
--
-- It has to be separate state. Deriving it from last_error_at would mean either
-- re-sending on every failed run — a dead HubSpot grant fails every workflow,
-- every sweep, so that is dozens of identical emails in a day — or picking an
-- arbitrary silence window and hoping. A nullable timestamp says exactly one
-- thing: null means unreported, non-null means reported at that moment.
--
-- The rule the code enforces around these columns:
--
--   break        → status = 'needs_reauth', broken_notified_at stays null
--   digest sent  → broken_notified_at = now()
--   reconnect    → status = 'active', broken_notified_at back to null
--
-- That last step is what makes a second break notifiable. Without it, a customer
-- who breaks, gets told, fixes it, and breaks again would hear nothing the
-- second time — the worst possible failure for a feature whose entire job is
-- telling people.

alter table hubspot_connections add column if not exists broken_notified_at timestamptz;
alter table slack_connections   add column if not exists broken_notified_at timestamptz;
alter table notion_connections  add column if not exists broken_notified_at timestamptz;

-- ─── Dead jobs ────────────────────────────────────────────────────────────────
-- A dead job is the record of an automation that silently did not happen, which
-- is exactly what the customer never found out about. Same one-shot rule: report
-- it once, in the next digest, and never again.
--
-- Note this is deliberately NOT cleared anywhere. A dead job is a historical
-- fact; unlike a connection it cannot "break again". Replaying one creates a
-- fresh job with its own row.

alter table jobs add column if not exists notified_at timestamptz;

-- Partial on both conditions, so the digest's lookup touches only jobs that are
-- dead AND unreported — which in a healthy system is zero rows. Ordered by
-- created_at so the digest lists oldest first: if several automations failed,
-- the one that has been broken longest is the one worth leading with.
create index if not exists jobs_dead_unnotified_idx
  on jobs (created_at) where status = 'dead' and notified_at is null;
