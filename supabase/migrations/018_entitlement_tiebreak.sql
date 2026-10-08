-- Run this in the Supabase SQL editor after 017_workflow_steps_constraint.sql.

-- ─── The "most recent subscription" was decided by a coin toss ────────────────
-- 014 left this function picking one row with:
--
--   order by s.updated_at desc
--   limit 1
--
-- which assumes updated_at distinguishes the candidates. It does not.
-- claim_subscription_for_customer runs on every sign-in and stamps every row it
-- links with the same timestamp, so two subscription rows for one customer
-- share an updated_at to the microsecond. That is the normal state for anyone
-- with more than one subscription, not an edge case.
--
-- With the sort key tied, `limit 1` returns whichever row Postgres reaches
-- first. Which plan an account resolves to was therefore not determined by
-- anything in the data.
--
-- It has been correct so far only by luck: the account that has two rows has
-- one expired comp and one live subscription, and the date filter removes the
-- comp before the ordering is ever consulted. An account holding two *valid*
-- entitlements would have got an arbitrary one.
--
-- ─── Why this returns every valid row now ─────────────────────────────────────
-- Picking "the best" entitlement means ranking plans, and lib/plans.ts is
-- deliberate that what a plan *means* lives in code, not the database:
--
--   "Limits live in code rather than the database on purpose: they are product
--    decisions that should move with a deploy and be reviewable in a diff"
--
-- Encoding free < starter < growth here would be the second place that knows
-- it, and the one nobody would think to update. So this filters and orders;
-- getEntitlements chooses.
--
-- The ordering is still fully deterministic — longest-running entitlement
-- first, a null period end (an indefinite grant) ahead of any dated one, then
-- most recently touched, then id so the result never depends on physical row
-- order. getEntitlements takes the highest-ranked plan and uses this order only
-- to break ties between equal plans.

create or replace function entitlements_for_customer(
  p_customer_id uuid,
  p_grace_hours integer default 48
)
returns table (plan text, status text, current_period_end timestamptz)
language sql
security definer
set search_path = public, pg_temp
as $$
  select s.plan, s.status, s.current_period_end
    from subscriptions s
    join customers c on c.id = p_customer_id
   where (s.customer_id = p_customer_id or lower(s.email) = lower(c.email))
     and s.status in ('active', 'trialing')
     and (
       s.current_period_end is null
       or s.current_period_end > now() - make_interval(hours => p_grace_hours)
     )
   order by s.current_period_end desc nulls first,
            s.updated_at desc,
            s.id;
$$;

revoke all on function entitlements_for_customer(uuid, integer) from public, anon, authenticated;
grant execute on function entitlements_for_customer(uuid, integer) to service_role;
