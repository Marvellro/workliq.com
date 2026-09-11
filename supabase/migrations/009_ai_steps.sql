-- Run this in the Supabase SQL editor after 008_job_queue.sql.

-- ─── AI workflow steps ────────────────────────────────────────────────────────
-- Adds `ai_step` as a workflow action: instead of posting a fixed template,
-- Claude reads the deal and produces a summary, a drafted follow-up, a lead
-- score, or a recommended next action, which is then delivered through an
-- existing channel.
--
-- Unlike every other action, this one costs real money per execution and the
-- amount is not knowable in advance. That is the reason for everything below:
-- without a recorded, enforced budget, a customer with a large portfolio and a
-- badly-scoped workflow could run up an unbounded bill against our API key.

-- The action_type check constraint is recreated to include 'ai_step'.
alter table workflows drop constraint if exists workflows_action_type_check;
alter table workflows add constraint workflows_action_type_check
  check (action_type in ('slack_message', 'notion_row', 'webhook', 'ai_step'));

-- ─── customers: AI spend budget ───────────────────────────────────────────────
-- Hard monthly ceiling in USD. When the month's recorded spend reaches this,
-- ai_step actions fail closed rather than continuing to bill.
--
-- Default 5.00: enough for roughly a thousand short deal summaries, low enough
-- that a misconfigured workflow is a rounding error rather than an incident.
-- Phase 4 will set this from the customer's plan.

alter table customers
  add column if not exists ai_monthly_budget_usd numeric(10,2) not null default 5.00;

comment on column customers.ai_monthly_budget_usd is
  'Hard ceiling on AI spend per calendar month. ai_step actions fail closed above it.';

-- ─── ai_usage ─────────────────────────────────────────────────────────────────
-- One row per model call. This is both the meter and the audit trail: it has to
-- answer "what did this customer actually spend, and on what" precisely enough
-- to bill from and to debug a surprising invoice.
--
-- Token counts are stored alongside the computed cost rather than only the cost,
-- because per-token prices change. Keeping the raw counts means historical rows
-- can be re-costed; keeping only dollars would make that impossible.

create table if not exists ai_usage (
  id                  uuid primary key default gen_random_uuid(),
  customer_id         uuid not null references customers(id) on delete cascade,
  workflow_id         uuid references workflows(id) on delete set null,
  job_id              uuid,

  task                text not null,     -- summarize | draft_followup | score_lead | next_action
  model               text not null,

  input_tokens        integer not null default 0,
  output_tokens       integer not null default 0,
  cache_read_tokens   integer not null default 0,
  cache_write_tokens  integer not null default 0,

  -- Computed at write time from the token counts and the price table in
  -- lib/ai-pricing.ts. numeric, never float: a single call can cost fractions
  -- of a cent and float rounding errors accumulate across thousands of rows
  -- into a figure that doesn't reconcile.
  cost_usd            numeric(12,6) not null default 0,

  -- Recorded even for failed calls: a refusal or a timeout after the model has
  -- read the input is still billed, so leaving those out would under-report.
  succeeded           boolean not null default true,
  error_message       text,

  created_at          timestamptz not null default now()
);

-- Supports the monthly-spend lookup that runs before every AI call.
create index if not exists ai_usage_customer_month_idx
  on ai_usage (customer_id, created_at desc);

create index if not exists ai_usage_workflow_idx on ai_usage (workflow_id, created_at desc);

alter table ai_usage enable row level security;

-- Customers can see their own spend. Writes are service-role only.
create policy "Customers can read their own AI usage"
  on ai_usage for select
  using (auth.uid() = customer_id);

-- ─── ai_spend_this_month ──────────────────────────────────────────────────────
-- Returns a customer's spend for the current calendar month and their ceiling.
--
-- A function rather than an application-side query so the budget check is one
-- round trip on the hot path, and so the definition of "this month" lives in
-- one place instead of being re-derived (and eventually diverging) in code.

create or replace function ai_spend_this_month(p_customer_id uuid)
returns table (spent_usd numeric, budget_usd numeric, remaining_usd numeric)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce(sum(u.cost_usd), 0)::numeric as spent_usd,
    c.ai_monthly_budget_usd               as budget_usd,
    greatest(0, c.ai_monthly_budget_usd - coalesce(sum(u.cost_usd), 0))::numeric as remaining_usd
  from customers c
  left join ai_usage u
    on u.customer_id = c.id
   and u.created_at >= date_trunc('month', now())
  where c.id = p_customer_id
  group by c.ai_monthly_budget_usd;
$$;

revoke all on function ai_spend_this_month(uuid) from public, anon, authenticated;
grant execute on function ai_spend_this_month(uuid) to service_role;
