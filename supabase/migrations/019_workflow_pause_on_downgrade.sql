-- Run this in the Supabase SQL editor after 018_entitlement_tiebreak.sql.

-- ─── Plan limits were never enforced once a workflow was running ──────────────
-- checkWorkflowLimit and checkActionAllowed are called when a workflow is
-- created and when one is enabled. Neither appears anywhere in the execution
-- path.
--
-- So the limit governed how many workflows an account could *switch on*, and
-- nothing at all about how many kept running. A customer who cancelled dropped
-- to Free and carried on with every workflow they had — ten of them against a
-- limit of one — indefinitely. Only AI stopped, because that budget is the one
-- thing checked at run time.
--
-- The entitlement that never expired and the period end that was never stored
-- were the same shape: billing state changed and the running system did not
-- notice.
--
-- ─── Why pause rather than refuse at execution ────────────────────────────────
-- Refusing inside the executor is cheaper, but it needs an arbitrary rule for
-- which workflows lose, applied silently, every time one fires. The customer
-- sees automations that simply stop, with nothing to look at.
--
-- Pausing is a decision taken once, at the moment the plan changes, recorded
-- against the workflow, and reported. The customer can see which ones were
-- paused and why, and `enabled` keeps meaning exactly what it says.
--
--   paused_by_plan      this was switched off by a billing change, not by a
--                       person. Distinguishing the two is the whole point: a
--                       workflow a customer paused deliberately must not be
--                       described back to them as something we did.
--   paused_at           when.
--   paused_notified_at  whether the customer has been told, kept separate from
--                       paused_at for the same reason 013 keeps notification
--                       state separate — deriving it from the event means
--                       either re-sending forever or guessing a window.

alter table workflows add column if not exists paused_by_plan     boolean not null default false;
alter table workflows add column if not exists paused_at          timestamptz;
alter table workflows add column if not exists paused_notified_at timestamptz;

comment on column workflows.paused_by_plan is
  'True when a billing change switched this off, not a person. Cleared whenever the customer enables it again - from then on the state is theirs.';

-- Partial, because in a healthy account nothing is paused. Ordered by paused_at
-- so the digest can read "what was paused, oldest first" straight off it.
create index if not exists workflows_paused_unnotified_idx
  on workflows (paused_at) where paused_by_plan and paused_notified_at is null;
