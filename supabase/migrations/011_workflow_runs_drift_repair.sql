-- Applied 2026-09-15, during the first production walkthrough.

-- ─── Schema drift repair: workflow_runs.status ────────────────────────────────
-- The live table did not match what 005_workflows.sql declares. Two differences,
-- both on the same column, and both fatal to the design that column exists for:
--
--   declared in 005          live database
--   ───────────────────────  ─────────────────────────────
--   default 'pending'        no default
--   check in (pending,       check in (success, failed)
--             success, failed)
--
-- 'pending' is not decorative. lib/workflow-execute.ts claims a run by upserting
-- ONLY the conflict-key columns before executing the action, so that ON CONFLICT
-- leaves an existing status untouched — that is what makes a workflow fire
-- exactly once across retries, and across both the webhook and the
-- reconciliation path. Sending status explicitly would reset a prior 'success'
-- to 'pending' on every retry and defeat the deduplication entirely.
--
-- So the claim could never succeed: the first real workflow run in production
-- failed here, twice, before the queue's retry logic carried it through.
--
-- ─── Why it drifted ───────────────────────────────────────────────────────────
-- Every table in 001–005 is created with `create table if not exists`. That is
-- silently non-idempotent in the dangerous direction: if the table already
-- exists with a DIFFERENT definition, the statement is skipped rather than
-- failing, and the old shape survives while the migration file reads as though
-- it were applied. workflow_runs evidently existed from an earlier iteration
-- whose status column predated the claim-first pattern.
--
-- Nothing else drifted — a full audit of all eight tables from 001–005
-- (columns, defaults, nullability, primary/unique/check constraints, indexes
-- including the partial one, foreign keys with their cascade behaviour, RLS
-- state and every policy) found these two and nothing more.
--
-- The lesson worth carrying: `if not exists` makes a migration a no-op against
-- a table whose shape disagrees, so a migration file is evidence of intent, not
-- evidence of state. Verify against the live schema after applying anything
-- that matters.

alter table workflow_runs alter column status set default 'pending';

alter table workflow_runs drop constraint if exists workflow_runs_status_check;
alter table workflow_runs add constraint workflow_runs_status_check
  check (status in ('pending', 'success', 'failed'));
