-- Run this in the Supabase SQL editor after 006_credential_encryption.sql.

-- ─── audit_log ────────────────────────────────────────────────────────────────
-- Append-only record of security-relevant events: logins, OAuth connections,
-- workflow changes, admin actions, rate-limit trips.
--
-- Deliberately has no update or delete policy and no application code path that
-- modifies a row. An audit trail that the application can rewrite is not an
-- audit trail — if the app is compromised, the first thing an attacker edits is
-- the record of what they did.
--
-- metadata is jsonb for flexibility, but callers must never put tokens, webhook
-- URLs, or other secrets in it (see lib/audit.ts). This table is the one place
-- most likely to be exported wholesale for a compliance review.

create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  action      text not null,
  customer_id uuid references customers(id) on delete set null,
  -- Kept as free text rather than an FK: it records who acted, which may be an
  -- admin email or a system identity, and the record must survive the customer
  -- row being deleted (that deletion is itself auditable).
  actor       text,
  metadata    jsonb not null default '{}'::jsonb,
  ip          text,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_customer_idx  on audit_log(customer_id, created_at desc);
create index if not exists audit_log_action_idx    on audit_log(action, created_at desc);
create index if not exists audit_log_created_idx   on audit_log(created_at desc);

alter table audit_log enable row level security;

-- Customers may read their own history (for a future "account activity" view).
-- No insert/update/delete policy exists for anyone: writes happen only via the
-- service role in lib/audit.ts, which bypasses RLS.
create policy "Customers can read their own audit entries"
  on audit_log for select
  using (auth.uid() = customer_id);

-- ─── rate_limits ──────────────────────────────────────────────────────────────
-- Fixed-window counters backing lib/rate-limit.ts.

create table if not exists rate_limits (
  key          text        not null,
  window_start timestamptz not null,
  count        integer     not null default 0,

  primary key (key, window_start)
);

-- Supports the cleanup delete below.
create index if not exists rate_limits_window_idx on rate_limits(window_start);

alter table rate_limits enable row level security;
-- No policies: only the service role touches this table.

-- ─── check_rate_limit ─────────────────────────────────────────────────────────
-- Increments the counter for `p_key` in the current window and reports whether
-- the caller is within `p_max`.
--
-- The increment and the read happen in a single statement. Doing this as a
-- SELECT followed by an UPDATE from the application would let two concurrent
-- requests both read count = max - 1, both conclude they were under the limit,
-- and both proceed — which is exactly the concurrency an attacker running a
-- parallel OTP brute-force produces.

create or replace function check_rate_limit(
  p_key            text,
  p_window_seconds integer,
  p_max            integer
)
returns table (allowed boolean, request_count integer, retry_after integer)
language plpgsql
security definer
-- Pin the search path: without it, a SECURITY DEFINER function can be tricked
-- into resolving `rate_limits` to an attacker-created table in a schema earlier
-- on the caller's search_path, and would then run with the definer's rights.
set search_path = public, pg_temp
as $$
declare
  v_window_start timestamptz;
  v_count        integer;
begin
  if p_window_seconds <= 0 then
    raise exception 'p_window_seconds must be positive';
  end if;

  -- Truncate now() down to the start of its window, so every request inside the
  -- same window maps to the same row.
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into rate_limits as rl (key, window_start, count)
  values (p_key, v_window_start, 1)
  on conflict (key, window_start)
    do update set count = rl.count + 1
  returning rl.count into v_count;

  return query select
    v_count <= p_max,
    v_count,
    greatest(
      0,
      ceil(
        extract(epoch from (v_window_start + make_interval(secs => p_window_seconds)) - now())
      )::integer
    );
end;
$$;

-- Only the server (service role) may call this. Without these revokes any
-- browser holding the anon key could inflate another user's counter and lock
-- them out — a denial-of-service against a specific customer's login.
revoke all on function check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function check_rate_limit(text, integer, integer) to service_role;

-- ─── purge_expired_rate_limits ────────────────────────────────────────────────
-- Rate-limit rows are worthless once their window has passed. Called from the
-- daily cron so the table doesn't grow without bound.

create or replace function purge_expired_rate_limits()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from rate_limits where window_start < now() - interval '24 hours';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function purge_expired_rate_limits() from public, anon, authenticated;
grant execute on function purge_expired_rate_limits() to service_role;

-- ─── admins: missing SELECT policy ────────────────────────────────────────────
-- `admins` had RLS enabled with zero policies, while the waitlist policies from
-- an earlier migration evaluate `EXISTS (SELECT 1 FROM admins WHERE
-- admins.email = auth.email())`. RLS applies to tables referenced inside a
-- policy expression too, so that subquery returned no rows for every caller —
-- meaning even a genuine admin could never read the waitlist through the anon
-- key, and the admin page rendered empty.
--
-- Letting a user see only their own admin row is the minimum that makes those
-- policies evaluate correctly; it does not expose the list of admins.

create policy "Admins can read their own admin row"
  on admins for select
  using (email = auth.email());
