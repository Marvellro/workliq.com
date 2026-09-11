'use client'

import { useState, useCallback, useEffect, useSyncExternalStore } from 'react'

type Run = {
  id: string
  workflow_id: string
  deal_id: string
  trigger_fingerprint: string
  status: 'pending' | 'success' | 'failed'
  error_message: string | null
  fired_at: string
  workflows: { name: string; action_type: string } | null
}

type QueueItem = {
  id: string
  kind: string
  status: 'pending' | 'running' | 'dead'
  attempts: number
  max_attempts: number
  last_error: string | null
  run_after: string
  created_at: string
}

type AISpend = {
  spentUsd: number
  budgetUsd: number
  remainingUsd: number
}

type Props = {
  initialRuns: Run[]
  initialQueue: QueueItem[]
  initialSpend: AISpend | null
}

// Matches lib/ai-pricing.ts formatUsd. Sub-cent amounts keep precision — a real
// charge shown as "$0.00" reads as either free or broken.
function formatUsd(amount: number): string {
  if (amount === 0) return '$0.00'
  if (amount < 0.01) return `$${amount.toFixed(4)}`
  return `$${amount.toFixed(2)}`
}

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  success: { bg: '#E4F3EC', fg: '#0F7B4F', label: 'Delivered' },
  failed: { bg: '#FBEAEA', fg: '#A4161A', label: 'Failed' },
  pending: { bg: '#FDF0E1', fg: '#B45309', label: 'Pending' },
  running: { bg: '#E7EEFC', fg: '#1A56DB', label: 'Running' },
  dead: { bg: '#FBEAEA', fg: '#A4161A', label: 'Gave up' },
}

// `now` is passed in rather than read from Date.now() inside the component.
// Reading the clock during render is impure: it makes the server-rendered HTML
// and the first client render disagree (a hydration mismatch), and it defeats
// memoization because every render produces a different value. Holding the
// current time in state instead makes it an ordinary prop that changes on a
// tick we control — which also makes these labels actually count up.
function timeAgo(iso: string, now: number): string {
  const seconds = Math.floor((now - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function describeTrigger(fingerprint: string, dealId: string): string {
  // Fingerprints are built by the engine as:
  //   deal_created        -> "<dealId>"
  //   deal_stage_changed  -> "<dealId>:<stage>"
  //   deal_stale          -> "<dealId>:<thresholdDays>"
  const suffix = fingerprint.startsWith(`${dealId}:`)
    ? fingerprint.slice(dealId.length + 1)
    : null
  if (!suffix) return 'Deal created'
  return /^\d+$/.test(suffix) ? `Stale ${suffix}+ days` : `Moved to ${suffix}`
}

// The current time is an external, mutable source, which is exactly what
// useSyncExternalStore is for. Two details make it correct here:
//
//   • getSnapshot is quantised to the tick interval. useSyncExternalStore calls
//     it on every render and requires a stable value between notifications —
//     a raw Date.now() changes every call and spins into an infinite loop.
//   • getServerSnapshot returns 0, so the server-rendered HTML and the first
//     client render agree. Callers show an absolute date for that first frame
//     and switch to relative once mounted, instead of hydration-mismatching.
const TICK_MS = 15_000

function useNow(): number {
  return useSyncExternalStore(
    (onChange) => {
      const id = setInterval(onChange, TICK_MS)
      return () => clearInterval(id)
    },
    () => Math.floor(Date.now() / TICK_MS) * TICK_MS,
    () => 0
  )
}

export default function ActivityClient({ initialRuns, initialQueue, initialSpend }: Props) {
  const [runs, setRuns] = useState<Run[]>(initialRuns)
  const [queue, setQueue] = useState<QueueItem[]>(initialQueue)
  const [spend, setSpend] = useState<AISpend | null>(initialSpend)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const now = useNow()

  const refresh = useCallback(async () => {
    const res = await fetch('/api/runs')
    if (!res.ok) return
    const json = await res.json()
    setRuns(json.runs)
    setQueue(json.queue)
    setSpend(json.aiSpend ?? null)
  }, [])

  // Work moves through the queue in the background, so a static snapshot goes
  // stale within seconds of a deal changing. Refetching on the same cadence as
  // the clock keeps the timestamps and the rows they label in step.
  useEffect(() => {
    const id = setInterval(refresh, TICK_MS)
    return () => clearInterval(id)
  }, [refresh])

  async function replay(jobId: string) {
    setBusyId(jobId)
    const res = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
    })
    setToast(res.ok ? 'Queued for another attempt.' : 'Could not replay that one.')
    setTimeout(() => setToast(null), 3500)
    await refresh()
    setBusyId(null)
  }

  const dead = queue.filter((q) => q.status === 'dead')
  const inFlight = queue.filter((q) => q.status !== 'dead')

  return (
    <main style={{ minHeight: '100vh', background: '#F9FAFB', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <nav style={{ background: '#fff', borderBottom: '0.5px solid #E5E7EB', padding: '0 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, background: '#1A56DB', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: '#fff' }}>W</div>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#0D0F1A', letterSpacing: '-0.025em' }}>Workliq</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/dashboard/workflows" style={{ fontSize: 13, color: '#6B7280', textDecoration: 'none', border: '1px solid #E5E7EB', borderRadius: 6, padding: '0.35rem 0.75rem' }}>
            Workflows
          </a>
          <a href="/dashboard" style={{ fontSize: 13, color: '#6B7280', textDecoration: 'none', border: '1px solid #E5E7EB', borderRadius: 6, padding: '0.35rem 0.75rem' }}>
            Connections
          </a>
        </div>
      </nav>

      {toast && (
        <div style={{ position: 'fixed', top: 70, right: 24, zIndex: 50, background: '#0D0F1A', color: '#fff', fontSize: 13, padding: '0.6rem 1rem', borderRadius: 8 }}>
          {toast}
        </div>
      )}

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '2.5rem 1.5rem' }}>
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: '#0D0F1A', marginBottom: '0.4rem', letterSpacing: '-0.02em' }}>
            Activity
          </h1>
          <p style={{ fontSize: 14, color: '#6B7280' }}>
            Every action your workflows have taken, and anything still waiting.
          </p>
        </div>

        {spend && spend.spentUsd > 0 && (
          <section style={{ marginBottom: '2rem' }}>
            <div style={{ background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 10, padding: '1rem 1.1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#0D0F1A' }}>AI spend this month</span>
                <span style={{ fontSize: 13, color: '#6B7280', fontVariantNumeric: 'tabular-nums' }}>
                  {formatUsd(spend.spentUsd)} of {formatUsd(spend.budgetUsd)}
                </span>
              </div>
              <div style={{ height: 6, background: '#F3F4F6', borderRadius: 3, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, (spend.spentUsd / Math.max(spend.budgetUsd, 0.0001)) * 100)}%`,
                    background: spend.remainingUsd <= 0 ? '#A4161A' : '#1A56DB',
                    borderRadius: 3,
                  }}
                />
              </div>
              {spend.remainingUsd <= 0 && (
                <p style={{ fontSize: 12, color: '#A4161A', marginTop: 8 }}>
                  Budget used up — AI steps will not run until next month. Other actions are unaffected.
                </p>
              )}
            </div>
          </section>
        )}

        {dead.length > 0 && (
          <section style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, color: '#A4161A', marginBottom: '0.75rem' }}>
              Needs attention
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {dead.map((job) => (
                <div key={job.id} style={{ background: '#fff', border: '0.5px solid #E5E7EB', borderLeft: '3px solid #A4161A', borderRadius: 8, padding: '0.9rem 1.1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: '#0D0F1A', marginBottom: 3 }}>
                        Gave up after {job.attempts} attempt{job.attempts === 1 ? '' : 's'}
                      </p>
                      <p style={{ fontSize: 13, color: '#6B7280', wordBreak: 'break-word' }}>
                        {job.last_error ?? 'No error recorded'}
                      </p>
                    </div>
                    <button
                      onClick={() => replay(job.id)}
                      disabled={busyId === job.id}
                      style={{ fontSize: 13, fontWeight: 600, color: '#1A56DB', background: '#fff', border: '1px solid #D1D5DB', borderRadius: 6, padding: '0.35rem 0.75rem', cursor: busyId === job.id ? 'default' : 'pointer', whiteSpace: 'nowrap', opacity: busyId === job.id ? 0.5 : 1 }}
                    >
                      {busyId === job.id ? 'Queuing…' : 'Try again'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {inFlight.length > 0 && (
          <section style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, color: '#6B7280', marginBottom: '0.75rem' }}>
              In progress
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {inFlight.map((job) => {
                const s = STATUS_STYLE[job.status]
                const due = new Date(job.run_after).getTime() - now
                return (
                  <div key={job.id} style={{ background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 8, padding: '0.8rem 1.1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 13, color: '#374151' }}>
                      {job.attempts > 0
                        ? `Retrying${due > 0 ? ` in ${Math.ceil(due / 60000)}m` : ' shortly'} · attempt ${job.attempts + 1} of ${job.max_attempts}`
                        : 'Queued'}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 600, background: s.bg, color: s.fg, padding: '0.2rem 0.5rem', borderRadius: 4 }}>
                      {s.label}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        <section>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: '#6B7280', marginBottom: '0.75rem' }}>
            History
          </h2>

          {runs.length === 0 ? (
            <div style={{ background: '#fff', border: '0.5px dashed #D1D5DB', borderRadius: 12, padding: '2.5rem 1.5rem', textAlign: 'center' }}>
              <p style={{ fontSize: 14, color: '#6B7280' }}>
                Nothing yet. Actions appear here as soon as a workflow fires.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {runs.map((run) => {
                const s = STATUS_STYLE[run.status]
                return (
                  <div key={run.id} style={{ background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 8, padding: '0.9rem 1.1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: 14, fontWeight: 600, color: '#0D0F1A', marginBottom: 3 }}>
                          {run.workflows?.name ?? 'Deleted workflow'}
                        </p>
                        <p style={{ fontSize: 13, color: '#6B7280' }}>
                          {describeTrigger(run.trigger_fingerprint, run.deal_id)} · deal {run.deal_id}
                        </p>
                        {run.error_message && (
                          <p style={{ fontSize: 12, color: '#A4161A', marginTop: 5, wordBreak: 'break-word' }}>
                            {run.error_message}
                          </p>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 11, fontWeight: 600, background: s.bg, color: s.fg, padding: '0.2rem 0.5rem', borderRadius: 4 }}>
                          {s.label}
                        </span>
                        <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: 5 }}>
                          {now === 0 ? new Date(run.fired_at).toLocaleDateString() : timeAgo(run.fired_at, now)}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
