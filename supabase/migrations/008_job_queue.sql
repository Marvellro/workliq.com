-- Run this in the Supabase SQL editor after 007_audit_and_rate_limits.sql.

-- ─── jobs ─────────────────────────────────────────────────────────────────────
-- Durable work queue.
--
-- Before this, a workflow action ran inline inside the cron request and got
-- exactly one attempt. A Slack outage, a momentary 502 from a customer's
-- webhook, or the serverless function hitting its time limit meant the action
-- was recorded as failed and never tried again — the customer simply never got
-- their alert, and nothing retried it.
--
-- Postgres rather than SQS/QStash/Temporal: the queue needs to be transactional
-- with the data it acts on, this project already runs Postgres, and a separate
-- queue vendor is another credential to rotate and another outage surface. At
-- this volume `FOR UPDATE SKIP LOCKED` is a well-trodden pattern. The interface
-- in lib/jobs.ts is deliberately narrow so the backend can be swapped later
-- without touching callers.

create table if not exists jobs (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid references customers(id) on delete cascade,

  -- Discriminator for the handler that runs this job. Kept as text rather than
  -- an enum so adding a job kind doesn't require a migration.
  kind             text not null,
  payload          jsonb not null default '{}'::jsonb,

  -- Deduplication key. Two enqueues carrying the same key collapse into one
  -- job, which is what makes the whole pipeline safe to re-run: a webhook
  -- HubSpot delivers twice, or a reconciliation poll that re-observes an event
  -- the webhook already reported, must not fire the customer's action twice.
  idempotency_key  text,

  status           text not null default 'pending'
                     check (status in ('pending', 'running', 'succeeded', 'failed', 'dead')),

  attempts         integer not null default 0,
  max_attempts     integer not null default 5,

  -- Earliest time this job may be claimed. Retries set it into the future to
  -- implement backoff; scheduled work can set it at enqueue time.
  run_after        timestamptz not null default now(),

  -- Lease fields. locked_at lets a crashed worker's jobs be reclaimed: a
  -- serverless function that is killed mid-execution never gets to write a
  -- failure, so without a lease timeout its jobs would sit in 'running'
  -- forever.
  locked_at        timestamptz,
  locked_by        text,

  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Partial index on exactly the claim predicate. The queue table accumulates
-- succeeded rows, and without this the claim query degrades into a scan over
-- history to find the few runnable rows.
create index if not exists jobs_claimable_idx
  on jobs (run_after, id)
  where status = 'pending';

create index if not exists jobs_stuck_idx
  on jobs (locked_at)
  where status = 'running';

create index if not exists jobs_customer_idx on jobs (customer_id, created_at desc);
create index if not exists jobs_dead_idx on jobs (created_at desc) where status = 'dead';

-- Partial unique index rather than a plain unique constraint: only unfinished
-- work needs to be unique. Once a job has succeeded or died, an identical key
-- may legitimately be enqueued again (e.g. the customer edits and re-runs a
-- workflow), and a full unique constraint would block that forever.
create unique index if not exists jobs_idempotency_idx
  on jobs (idempotency_key)
  where idempotency_key is not null and status in ('pending', 'running');

alter table jobs enable row level security;

create policy "Customers can read their own jobs"
  on jobs for select
  using (auth.uid() = customer_id);

-- ─── claim_jobs ───────────────────────────────────────────────────────────────
-- Atomically claims up to p_limit runnable jobs for one worker.
--
-- FOR UPDATE SKIP LOCKED is the point of the whole function: concurrent workers
-- skip rows another worker has locked instead of blocking on them, so two cron
-- invocations overlapping (or one long run plus the next scheduled run) process
-- disjoint sets rather than deadlocking or double-processing.
--
-- The UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED) shape matters: doing
-- the select and the update as separate statements reopens the race the lock
-- exists to close.

create or replace function claim_jobs(
  p_worker text,
  p_limit  integer default 20,
  p_lease_seconds integer default 300
)
returns setof jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Reclaim jobs whose lease expired. A worker killed mid-flight (serverless
  -- timeout, deploy, OOM) leaves rows in 'running' with no one working them.
  -- They return to the queue rather than being lost.
  --
  -- This is why every job handler must be idempotent: a job reclaimed this way
  -- may have already had partial effect before its worker died.
  update jobs
     set status = 'pending',
         locked_at = null,
         locked_by = null,
         last_error = coalesce(last_error, 'Worker lease expired; job requeued'),
         updated_at = now()
   where status = 'running'
     and locked_at < now() - make_interval(secs => p_lease_seconds);

  return query
  update jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         locked_at = now(),
         locked_by = p_worker,
         updated_at = now()
    from (
      select id
        from jobs
       where status = 'pending'
         and run_after <= now()
       order by run_after, id
       for update skip locked
       limit p_limit
    ) claimed
   where j.id = claimed.id
  returning j.*;
end;
$$;

revoke all on function claim_jobs(text, integer, integer) from public, anon, authenticated;
grant execute on function claim_jobs(text, integer, integer) to service_role;

-- ─── complete_job / fail_job ──────────────────────────────────────────────────

create or replace function complete_job(p_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update jobs
     set status = 'succeeded',
         locked_at = null,
         locked_by = null,
         last_error = null,
         updated_at = now()
   where id = p_id;
$$;

revoke all on function complete_job(uuid) from public, anon, authenticated;
grant execute on function complete_job(uuid) to service_role;

-- Records a failure and decides whether the job retries or dies.
--
-- p_retryable lets the caller distinguish a transient failure (5xx, timeout,
-- connection reset) from a permanent one (404 to a deleted webhook endpoint,
-- a malformed workflow config). Retrying a permanent failure five times just
-- delays the inevitable while burning the customer's rate limits.
create or replace function fail_job(
  p_id         uuid,
  p_error      text,
  p_retryable  boolean default true,
  p_backoff_seconds integer default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job     jobs;
  v_backoff integer;
  v_status  text;
begin
  select * into v_job from jobs where id = p_id;
  if not found then
    return null;
  end if;

  if not p_retryable or v_job.attempts >= v_job.max_attempts then
    -- Dead-letter: kept, never deleted. A job that exhausted its retries is
    -- the record of a customer whose automation silently didn't happen, and
    -- that needs to be inspectable and replayable, not discarded.
    v_status := 'dead';
  else
    v_status := 'pending';
  end if;

  -- Exponential backoff with a ceiling: 30s, 2m, 8m, 32m, capped at 1h.
  -- Retrying a struggling third-party API immediately makes its outage worse.
  v_backoff := coalesce(
    p_backoff_seconds,
    least(3600, 30 * power(4, greatest(0, v_job.attempts - 1))::integer)
  );

  update jobs
     set status     = v_status,
         last_error = left(p_error, 2000),
         locked_at  = null,
         locked_by  = null,
         run_after  = case when v_status = 'pending'
                           then now() + make_interval(secs => v_backoff)
                           else run_after end,
         updated_at = now()
   where id = p_id;

  return v_status;
end;
$$;

revoke all on function fail_job(uuid, text, boolean, integer) from public, anon, authenticated;
grant execute on function fail_job(uuid, text, boolean, integer) to service_role;

-- ─── purge_finished_jobs ──────────────────────────────────────────────────────
-- Succeeded jobs are retained briefly so a customer can see recent activity,
-- then removed. Dead jobs are NEVER purged here — they are the failure record.

create or replace function purge_finished_jobs(p_retain_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from jobs
   where status = 'succeeded'
     and updated_at < now() - make_interval(days => p_retain_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function purge_finished_jobs(integer) from public, anon, authenticated;
grant execute on function purge_finished_jobs(integer) to service_role;

-- ─── hubspot_events ───────────────────────────────────────────────────────────
-- Raw inbound webhook events, written before any processing.
--
-- Recorded first, processed second, on purpose: HubSpot allows roughly five
-- seconds to respond and retries anything slower. Doing the work inline would
-- mean either timing out (and being re-sent the same batch) or dropping events
-- under load. Writing the raw event and returning 200 immediately makes
-- delivery durable, and the queue does the work afterwards.
--
-- Keeping the raw payload also means a bug in event handling can be fixed and
-- the events replayed, rather than the data being gone.

create table if not exists hubspot_events (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid references customers(id) on delete cascade,
  portal_id         text not null,

  event_id          text not null,      -- HubSpot's eventId (not unique on its own)
  subscription_type text not null,      -- e.g. 'deal.propertyChange'
  object_id         text not null,      -- the deal ID
  property_name     text,
  property_value    text,
  occurred_at       timestamptz not null,

  raw               jsonb not null,
  processed_at      timestamptz,
  created_at        timestamptz not null default now(),

  -- HubSpot explicitly does not guarantee eventId uniqueness, and re-sends a
  -- whole batch when an endpoint is slow. Keying on the combination that
  -- actually identifies one occurrence makes redelivery a no-op.
  unique (portal_id, event_id, subscription_type, object_id, occurred_at)
);

create index if not exists hubspot_events_unprocessed_idx
  on hubspot_events (created_at)
  where processed_at is null;

create index if not exists hubspot_events_customer_idx
  on hubspot_events (customer_id, occurred_at desc);

alter table hubspot_events enable row level security;
-- No policies: service role only. Raw third-party payloads are not customer-facing.
