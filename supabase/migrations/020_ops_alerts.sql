-- Run this in the Supabase SQL editor after 019_workflow_pause_on_downgrade.sql.

-- ─── Telling the operator ─────────────────────────────────────────────────────
-- Twenty-seven files log errors to the console and none of it reaches a human.
-- If the Stripe webhook starts rejecting, the queue stops draining, or every
-- account's workflows begin failing at once, the only way to find out is to go
-- and look.
--
-- That is the same failure the customer digest exists to fix, left in place for
-- the person running the thing — and this stretch produced two proofs of it. A
-- paying customer could not see the cancel button for days. Signup had never
-- worked at all, and an auth user stranded on 14 September went unnoticed for
-- a month. Neither produced a signal anywhere.
--
-- ─── What this table is for ───────────────────────────────────────────────────
-- Not a log of problems — the data those are derived from already lives in
-- jobs, audit_log and the connection tables. This records what the operator has
-- already been *told*, so a condition that persists for a week does not send a
-- mail on every webhook that happens to arrive.
--
-- Same separation as broken_notified_at in 013 and paused_notified_at in 019:
-- "is wrong" and "has been reported" are different facts, and deriving the
-- second from the first means either re-sending forever or inventing a window.

create table if not exists ops_alerts (
  id         uuid primary key default gen_random_uuid(),
  -- Stable identifier for the condition, not the occurrence: 'queue_stalled',
  -- 'webhook_rejections'. The cooldown is per signal, so one noisy condition
  -- cannot drown out a different one appearing beside it.
  signal     text not null,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ops_alerts_signal_idx on ops_alerts (signal, created_at desc);

-- Operator-only. No customer ever reads this, and the service role is the only
-- thing that writes it.
alter table ops_alerts enable row level security;

comment on table ops_alerts is
  'What the operator has already been alerted about, so a persistent condition is reported once rather than on every sweep. Not a problem log - the underlying facts live in jobs, audit_log and the connection tables.';
