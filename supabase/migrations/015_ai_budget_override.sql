-- Run this in the Supabase SQL editor after 014_entitlement_expiry.sql.

-- ─── Make the AI budget override explicit ─────────────────────────────────────
-- syncAiBudgetToPlan needed to know whether a customer's AI budget was a
-- deliberate override or just the plan default, and it had no field saying so.
-- It inferred one: a value matching no plan default (0, 10, 50) must have been
-- set by hand, so leave it alone.
--
-- That inference is wrong in both directions, and both were live:
--
--   A customer who bought Starter sat at 7.50 against an advertised $10. The
--   value matched no plan default, so the purchase webhook preserved it and
--   silently delivered less than was paid for. The same early return also
--   skipped `plan`, which is why customers.plan was still null after a
--   successful purchase.
--
--   Every new signup starts at 5.00 (the default set in 009) while Free is $0.
--   At first login the sync sees 5.00, reads it as an override, and leaves it.
--   So a free account keeps $5/month of AI it never paid for, permanently.
--
-- Neither is a bug in the rule's intent. Not flattening a support gesture of
-- $25 on Starter is correct. The bug is guessing which values are gestures.
--
-- ─── The two columns now mean different things ────────────────────────────────
--   ai_budget_override_usd  null, or a deliberate ceiling for this one account.
--                           Nothing derives it; it is only ever set by hand.
--   ai_monthly_budget_usd   the effective ceiling, and the only thing
--                           ai_spend_this_month reads. Always written as
--                           `override ?? plan default`, unconditionally.
--
-- Keeping the effective value materialised preserves why it was put on the
-- customer row in the first place: the AI check runs on a hot path and should
-- not join through billing to find a number. Plan defaults live in code
-- (lib/plans.ts), so the database cannot derive this itself — which is exactly
-- why the write has to be unconditional rather than conditional on a guess.

alter table customers
  add column if not exists ai_budget_override_usd numeric(10,2);

alter table customers drop constraint if exists customers_ai_budget_override_check;
alter table customers add  constraint customers_ai_budget_override_check
  check (ai_budget_override_usd is null or ai_budget_override_usd >= 0);

comment on column customers.ai_budget_override_usd is
  'Deliberate per-account AI ceiling. Null means derive from the plan. Set by hand only; syncAiBudgetToPlan reads it and never writes it.';

-- ─── Stop handing new accounts a budget they did not buy ──────────────────────
-- 009 defaulted this to 5.00, which is not any plan's value. Free is 0, so a
-- new row should start at 0 and be raised by the first sync if the account is
-- actually paid. Existing rows are untouched: there is one customer and their
-- value was corrected by hand alongside this change.

alter table customers alter column ai_monthly_budget_usd set default 0;

comment on column customers.ai_monthly_budget_usd is
  'Effective monthly AI ceiling in USD, read by ai_spend_this_month. Derived: equals ai_budget_override_usd when set, otherwise the plan default from lib/plans.ts. Do not edit directly — set the override instead.';
