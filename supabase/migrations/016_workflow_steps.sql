-- Run this in the Supabase SQL editor after 015_ai_budget_override.sql.

-- ─── Workflows get steps ──────────────────────────────────────────────────────
-- A workflow had exactly one action, so "post to Slack AND write the Notion
-- row" could not be expressed. The ai_step action already worked around it with
-- a `deliver_to` field — a hard-coded second step, available to one action type
-- only — which is the clearest evidence the single-action model had run out.
--
-- ─── The part that is not just "add an array" ─────────────────────────────────
-- 005 says this, about workflow_runs:
--
--   "each workflow here has exactly one action, so a single success/failed row
--    per (workflow, deal, event) is sufficient and simpler"
--
-- That sentence is the whole problem. Retry safety currently rests on it: a job
-- re-runs unless its run row says 'success'. With two steps, step one
-- succeeding and step two failing marks the run 'failed' — so the retry starts
-- again from the top and sends the first Slack message a second time. Five
-- attempts, five duplicate messages, each one looking to the customer like the
-- product malfunctioning.
--
-- So the ledger becomes per step. step_index joins the uniqueness key, each
-- step claims its own row, and a retry skips the ones already marked success.
-- The claim-first pattern is unchanged — it just applies per step now.
--
-- Existing rows get step_index 0, which is exactly what they were: the single
-- step of a one-step workflow. No run history is invalidated.

alter table workflows
  add column if not exists steps jsonb not null default '[]'::jsonb;

-- Backfill before constraining: every existing workflow becomes a one-step
-- workflow carrying precisely what it already did.
update workflows
   set steps = jsonb_build_array(
         jsonb_build_object('action_type', action_type, 'action_config', action_config)
       )
 where jsonb_array_length(steps) = 0;

-- The shape constraint on `steps` is NOT here. It is in 017, and it has to be,
-- because of an ordering mistake worth recording rather than quietly fixing.
--
-- This file's `default '[]'::jsonb` is what lets the column be added to
-- existing rows. But code deployed before this migration inserts a workflow
-- without naming `steps`, so it gets that default — and a constraint requiring
-- at least one step rejects it. Applying both together took workflow creation
-- down in production until the new code shipped.
--
-- The general rule it illustrates: a constraint that the currently-running code
-- can violate must not be applied until that code is gone. Add the column with
-- a permissive default, deploy the code that always populates it, then
-- constrain.

comment on column workflows.steps is
  'Ordered actions, each {action_type, action_config}. Source of truth. The upper bound is a safety rail against absurd configurations, not a plan lever - per-step entitlement is checked in lib/plans.ts.';

-- ─── The old columns become legacy ────────────────────────────────────────────
-- Dropped to nullable rather than removed. Nothing writes them after this, and
-- steps[0] holds what they held, but keeping the data one release longer means
-- a rollback can still read a workflow rather than finding a null it cannot
-- switch on. Removing them is a follow-up, once nothing has read them for a
-- while.

alter table workflows alter column action_type   drop not null;
alter table workflows alter column action_config drop not null;

comment on column workflows.action_type is
  'LEGACY - superseded by steps[0].action_type in 016. No longer written. Retained for rollback safety; drop once nothing reads it.';

-- ─── workflow_runs: one row per step ──────────────────────────────────────────

alter table workflow_runs
  add column if not exists step_index integer not null default 0;

alter table workflow_runs drop constraint if exists workflow_runs_step_index_check;
alter table workflow_runs add  constraint workflow_runs_step_index_check
  check (step_index >= 0);

-- Replace the uniqueness key. The old one is what made a multi-step retry
-- re-run completed steps; it has to go in the same statement batch as its
-- replacement so there is no window where a duplicate run could be claimed.
alter table workflow_runs
  drop constraint if exists workflow_runs_workflow_id_deal_id_trigger_fingerprint_key;

alter table workflow_runs drop constraint if exists workflow_runs_step_key;
alter table workflow_runs add  constraint workflow_runs_step_key
  unique (workflow_id, deal_id, trigger_fingerprint, step_index);

comment on column workflow_runs.step_index is
  'Position of the step within workflows.steps. Part of the uniqueness key so a retry resumes after the last successful step instead of repeating side effects that already happened.';

-- ─── Why a step records its output ────────────────────────────────────────────
-- Resuming after a failure creates a second problem that is easy to miss.
--
-- "Draft a follow-up with AI, then post it to Slack" is the reason steps exist.
-- If the AI step succeeds and the Slack step fails, the retry correctly skips
-- the AI step — we are not paying for that call twice, and it had no side
-- effect worth repeating. But the Slack step still needs the text the AI step
-- produced, and it is gone: the step that held it was skipped.
--
-- Without this column the retry would deliver the message with the generated
-- text silently missing — the one part the customer built the workflow for,
-- absent, with the delivery itself reported as a success.
--
-- Only steps that produce something store anything here; the rest are null.

alter table workflow_runs add column if not exists output text;

comment on column workflow_runs.output is
  'What this step produced, when it produces anything (currently ai_step only). Read back on retry so a later step referencing {{stepN}} still has it after the step itself was skipped.';
