# How work actually gets scheduled

Three things move work through the system. Only one of them is a cron job, and
that is deliberate.

## The constraint

**Vercel's Hobby plan allows cron jobs to run once per day.** This is not a
throttle — a sub-daily schedule like `*/5 * * * *` fails the *deployment* with
`Hobby accounts are limited to daily cron jobs`. So `vercel.json` contains only
daily schedules, and nothing that needs to be timely is allowed to depend on
cron.

Since then the gap described in section 2 is closed from inside the database:
`pg_cron` calls the worker endpoint every minute (`021_queue_pinger.sql`),
authenticating with `CRON_SECRET` read from Supabase Vault at run time. Coupling
the pinger to Postgres is deliberate — when the database is down there is
nothing to drain, so it fails exactly when draining was impossible anyway.

A GitHub Actions workflow (`.github/workflows/worker.yml`) was tried first and
is kept as a free secondary, not relied on. Its schedule is best-effort and,
measured here, its first scheduled run arrived nine hours late. The Vercel daily
cron is also kept, as the floor under both.

Verifying the pinger: `cron.job_run_details` reports `succeeded` once the HTTP
request is *enqueued*, so it is not evidence the worker ran. The evidence is in
`net._http_response` (kept six hours) — a `status_code` of 200 and a body
containing `"ok":true`.

## 1. Real time — the webhook path (no cron involved)

```
HubSpot event
   → POST /api/webhooks/hubspot
   → verify v3 signature, store raw event, enqueue job
   → 200 returned to HubSpot (well inside its ~5s budget)
   → after() drains the queue
```

`after()` (Next.js) runs work once the response has been sent, so HubSpot gets
its fast acknowledgement *and* the delivery happens immediately — in the same
invocation, with no scheduler in between. End-to-end latency is seconds.

This is why the queue worker being on a daily cron doesn't make delivery daily.

## 2. Retries — opportunistic, plus a daily floor

A job that fails is retried with backoff (30s → 2m → 8m → 32m → 1h). Something
has to come back and run it.

- Any subsequent webhook drains whatever is due, since `after()` claims *all*
  runnable jobs, not only the one it just queued. On an account with regular
  deal activity, retries are picked up within minutes.
- The daily `/api/cron/jobs` run is the floor that guarantees a retry
  eventually happens even with no activity at all.

**The gap:** on a quiet account, a failed delivery could wait up to a day. If
that matters, either option removes it without any code change:

- **Upgrade to Vercel Pro** and change `/api/cron/jobs` to `* * * * *`. Nothing
  else needs touching — the worker is already idempotent and budget-aware.
- **Point an external scheduler** (cron-job.org, GitHub Actions, Upstash QStash)
  at `GET /api/cron/jobs` every minute with
  `Authorization: Bearer $CRON_SECRET`. Free, and the endpoint already
  authenticates.

## 3. Reconciliation — the daily sweep

`/api/cron/workflows` re-reads every deal and queues anything missing. It exists
because webhooks are not a guarantee:

- a delivery can fail while our endpoint is down or deploying
- a subscription added later doesn't backfill events that already happened
- **staleness is time-based** — "this deal has had no activity for 14 days" is
  not an event HubSpot emits, so nothing will ever push it

Both paths build the same idempotency key
(`workflow.action:<workflow>:<deal>:<fingerprint>`), and `workflow_runs` carries
a unique constraint on the same triple. An event seen by both paths is delivered
exactly once.

## Why not a queue vendor

SQS, QStash and Temporal all solve this. Each is also another credential to
rotate, another outage surface, and another bill. Postgres is already here, the
queue needs to be transactional with the data it acts on, and `FOR UPDATE SKIP
LOCKED` is a well-understood pattern at this volume. The interface in
`lib/jobs.ts` is deliberately narrow so the backend can be swapped later without
touching a single caller.
