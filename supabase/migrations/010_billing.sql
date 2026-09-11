-- Run this in the Supabase SQL editor after 009_ai_steps.sql.

-- ─── Billing ──────────────────────────────────────────────────────────────────
-- Until now nothing ever recorded what a customer was paying for. Stripe
-- Checkout worked, money moved, and `customers.plan` stayed null forever — so
-- no limit could be enforced and no one could be downgraded when they stopped
-- paying.

-- ─── subscriptions ────────────────────────────────────────────────────────────
-- Keyed by EMAIL, not customer_id, and that is the important design decision.
--
-- The checkout flow is: pricing page → Stripe Checkout → /onboarding → sign up.
-- Payment therefore happens *before* the customer exists in our database, and
-- `customers.id` is a foreign key to auth.users so a placeholder row cannot be
-- invented. A subscriptions table keyed on customer_id would have nowhere to
-- put the very first webhook, which is the one that matters.
--
-- So the email that paid is the anchor. customer_id is filled in later, when
-- that person signs in and we can finally connect the two (see
-- claim_subscription_for_customer below).

create table if not exists subscriptions (
  id                     uuid primary key default gen_random_uuid(),

  -- Lowercased at write time. This is the join key to a future customer.
  email                  text not null,

  -- Null until the payer signs in.
  customer_id            uuid references customers(id) on delete set null,

  stripe_customer_id     text,
  stripe_subscription_id text,

  plan                   text not null,     -- starter | growth
  billing_period         text,              -- monthly | annual
  status                 text not null,     -- Stripe's subscription status, verbatim

  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- One row per Stripe subscription. Webhooks for the same subscription update
  -- in place rather than accumulating history.
  unique (stripe_subscription_id)
);

create index if not exists subscriptions_email_idx    on subscriptions (lower(email));
create index if not exists subscriptions_customer_idx on subscriptions (customer_id);

alter table subscriptions enable row level security;

create policy "Customers can read their own subscription"
  on subscriptions for select
  using (auth.uid() = customer_id);

-- ─── stripe_events ────────────────────────────────────────────────────────────
-- Inbound event log, written before processing — same shape as hubspot_events.
--
-- Stripe explicitly warns that an endpoint may receive the same event more than
-- once, and that two distinct Event objects can describe the same underlying
-- change. Recording the event id and refusing duplicates is what stops a
-- redelivered `customer.subscription.deleted` from downgrading an account that
-- has since resubscribed.

create table if not exists stripe_events (
  id            uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  type          text not null,
  raw           jsonb not null,
  processed_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists stripe_events_unprocessed_idx
  on stripe_events (created_at) where processed_at is null;

alter table stripe_events enable row level security;
-- No policies: service role only. Raw billing payloads are not customer-facing.

-- ─── claim_subscription_for_customer ──────────────────────────────────────────
-- Links any subscription paid for under this email to the customer row, called
-- when they sign in.
--
-- Matching is on lowercased email. Stripe stores whatever the payer typed, and
-- "Marvellous@Workliq.com" paying for an account created as
-- "marvellous@workliq.com" must resolve to the same person — otherwise they pay
-- and stay on the free plan, which is the worst possible bug in a billing
-- system.

create or replace function claim_subscription_for_customer(
  p_customer_id uuid,
  p_email       text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claimed integer;
begin
  update subscriptions
     set customer_id = p_customer_id,
         updated_at  = now()
   where lower(email) = lower(p_email)
     and (customer_id is null or customer_id = p_customer_id);

  get diagnostics v_claimed = row_count;
  return v_claimed;
end;
$$;

revoke all on function claim_subscription_for_customer(uuid, text) from public, anon, authenticated;
grant execute on function claim_subscription_for_customer(uuid, text) to service_role;

-- ─── entitlements_for_customer ────────────────────────────────────────────────
-- The single source of truth for "what is this account allowed to do".
--
-- Resolves by customer_id first, then falls back to email — so someone who has
-- paid but whose subscription has not yet been claimed still gets what they
-- paid for, rather than being told to upgrade on a plan they already bought.
--
-- Only `active` and `trialing` count. past_due, canceled, unpaid and incomplete
-- all fall back to the free plan: a subscription that is not being paid for is
-- not an entitlement.

create or replace function entitlements_for_customer(p_customer_id uuid)
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
   order by s.updated_at desc
   limit 1;
$$;

revoke all on function entitlements_for_customer(uuid) from public, anon, authenticated;
grant execute on function entitlements_for_customer(uuid) to service_role;
