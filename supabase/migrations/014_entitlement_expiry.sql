-- Run this in the Supabase SQL editor after 013_notification_state.sql.

-- ─── Entitlements must respect the period end ─────────────────────────────────
-- 010 returned current_period_end from this function and nothing ever read it.
-- getEntitlements checked only `status in ('active','trialing')`, so a
-- subscription whose period had ended kept full paid access indefinitely.
--
-- This was live: the walkthrough comp (current_period_end 2026-09-22) was still
-- granting Growth on 2026-09-30, eight days after it lapsed.
--
-- It is not a one-off. Two paths guarantee it recurs:
--
--   Stripe flips `status` by webhook. A missed or failed
--   customer.subscription.deleted leaves status 'active' forever, and the
--   account keeps paid access with nothing anywhere to notice. 012 and 013
--   exist precisely because webhooks silently fail to arrive.
--
--   A comp granted directly by SQL has no webhook at all. Nothing will ever
--   flip its status, so without a date check it cannot expire by any mechanism.
--
-- ─── Why the filter belongs here and not only in TypeScript ───────────────────
-- `order by s.updated_at desc limit 1` picks the most recently touched row, not
-- the most valid one. With the check only in the application, a stale expired
-- subscription that happened to be updated recently would shadow a live one and
-- the caller would never see the good row. Filtering here means the ordering
-- chooses among rows that are actually valid.
--
-- ─── Grace ────────────────────────────────────────────────────────────────────
-- p_grace_hours is a parameter rather than a literal so lib/plans.ts owns the
-- number and passes it — one source of truth instead of two that drift. The
-- default exists only so the function is still correct if called without it.
--
-- The grace window is deliberate and asymmetric. Stripe advances
-- current_period_end via the renewal webhook, so a late webhook would otherwise
-- drop a genuinely paying customer to Free the instant their period rolled
-- over. Wrongly denying access to someone who has paid is worse than briefly
-- over-granting to someone who has not, so this errs toward the customer —
-- the same asymmetry as the AI budget failing closed while the rate limiter
-- fails open.
--
-- ─── A null current_period_end never expires ──────────────────────────────────
-- Deliberate, and the one hole left open: it is the escape hatch for an
-- indefinite comp. Setting a date is what makes a grant temporary; leaving it
-- null is an explicit choice to have no end. Worth knowing when granting one.

drop function if exists entitlements_for_customer(uuid);

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
   order by s.updated_at desc
   limit 1;
$$;

revoke all on function entitlements_for_customer(uuid, integer) from public, anon, authenticated;
grant execute on function entitlements_for_customer(uuid, integer) to service_role;
