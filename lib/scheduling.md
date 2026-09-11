# How work actually gets scheduled

Three things move work through the system. Only one of them is a cron job, and
that is deliberate.

## The constraint

**Vercel's Hobby plan allows cron jobs to run once per day.** This is not a
throttle — a sub-daily schedule like `*/5 * * * *` fails the *deployment* with
`Hobby accounts are limited to daily cron jobs`. So `vercel.json` contains only
daily schedules, and nothing that needs to be timely is allowed to depend on
cron.

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
