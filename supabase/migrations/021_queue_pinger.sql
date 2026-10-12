-- Run this in the Supabase SQL editor after 020_ops_alerts.sql.

-- ─── Why the database calls the worker ───────────────────────────────────────
-- Vercel Hobby refuses any cron more frequent than daily, so on an account with
-- no incoming webhooks a failed delivery waited up to a day for its retry (see
-- lib/scheduling.md, and finding C in the review).
--
-- The first attempt to close that was a GitHub Actions schedule set to every
-- five minutes. It works — and it is unusable. Its first scheduled run arrived
-- 9 hours 4 minutes after the workflow went live and none followed in the next
-- 110 minutes: one scheduled run in ~11 hours, against roughly 130 slots due.
-- GitHub documents the schedule trigger as best-effort; in practice, for this
-- repository, that meant hours. It stays in place as a free secondary, not as
-- the mechanism.
--
-- pg_cron is a real scheduler, and it lives in the same database as the queue.
-- That coupling is a feature: when Postgres is down there is nothing to drain,
-- so the pinger fails exactly when draining was impossible anyway, and never
-- otherwise.
--
-- ─── The secret, and why it is not in this file ──────────────────────────────
-- The worker authenticates with CRON_SECRET. This repository is public, so the
-- value must not appear here. It is read from Supabase Vault at run time, by
-- name, inside the scheduled command — so it is not stored in cron.job either,
-- and is never part of anything that gets logged as the job's definition.
--
-- Store it once, in the SQL editor, with the same value as CRON_SECRET in
-- Vercel:
--
--   select vault.create_secret('<CRON_SECRET>', 'cron_secret',
--     'Bearer token the pg_cron queue pinger sends to /api/cron/jobs.');
--
-- Until that row exists the job makes no request at all — the select below
-- returns no rows, so net.http_get is never called. Applying this migration
-- before the secret is stored is therefore safe, and so is replaying it on a
-- branch database that has no secret: it sits inert rather than hammering the
-- production endpoint with unauthenticated requests.
--
-- Why Vault here, when 001 deliberately chose application-layer encryption
-- over Vault for customer credentials: Vault decrypts for anyone holding
-- database credentials. For a customer's HubSpot token that defeats the point,
-- because the token grants access to a system outside ours. CRON_SECRET grants
-- only "run our worker" — something anyone with database credentials can
-- already do far more directly by manipulating the queue. Storing it in Vault
-- gives such a person nothing they did not already have.
--
-- The secret now lives in three places: Vercel, GitHub repository secrets, and
-- here. Rotating it means rotating all three, or the callers left behind start
-- receiving 401s.
--
-- ─── Two traps, both of which would have shipped ─────────────────────────────
-- net.http_get defaults to a 2-second timeout. The worker routinely runs for
-- longer than that, so every call would have been recorded as timed out while
-- the drain quietly completed on Vercel's side — monitoring that reports
-- failure for a thing that is working. 58 seconds sits just under the route's
-- maxDuration of 60.
--
-- cron.job_run_details records 'succeeded' when the request was *enqueued*, not
-- when it returned 200. The job's own status is therefore not evidence the
-- worker ran. That evidence is in net._http_response, kept for six hours:
--
--   select created, status_code, timed_out, error_msg, left(content, 200)
--   from net._http_response order by created desc limit 10;
--
-- ─── Cadence ─────────────────────────────────────────────────────────────────
-- Every minute. Finding C specified that cadence for the Vercel Pro route, and
-- the first two retry backoffs (30s, 2m) assume a worker that runs often.
-- Overlapping runs are safe: jobs are claimed with FOR UPDATE SKIP LOCKED.
--
-- To stop it:   select cron.unschedule('drain-job-queue');

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- cron.schedule upserts by name, so re-running this file replaces the job
-- rather than adding a second one.
select cron.schedule(
  'drain-job-queue',
  '* * * * *',
  $cmd$
  select net.http_get(
    url                  := 'https://www.workliq.com/api/cron/jobs',
    headers              := jsonb_build_object('Authorization', 'Bearer ' || s.decrypted_secret),
    timeout_milliseconds := 58000
  )
  from vault.decrypted_secrets s
  where s.name = 'cron_secret';
  $cmd$
);
