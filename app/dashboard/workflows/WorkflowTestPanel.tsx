'use client'

import { useEffect, useState } from 'react'

// "Send a test": pick a real deal, run the workflow against it now, and see
// what each step did. See lib/workflow-test.ts for what a test is.

type Deal = { id: string; name: string; stage: string | null }

type StepResult = {
  index: number
  label: string
  status: 'success' | 'failed' | 'not_run'
  output: string | null
  error: string | null
}

type TestResult = {
  ok: boolean
  dealName: string
  simulated: string[]
  conditionNote: string | null
  steps: StepResult[]
  error: string | null
}

type Props = {
  workflowId: string
  enabled: boolean
  onClose: () => void
}

const box = { border: '1px solid #E5E7EB', borderRadius: 8, padding: '0.75rem 0.9rem', marginTop: '0.75rem' } as const

export default function WorkflowTestPanel({ workflowId, enabled, onClose }: Props) {
  const [deals, setDeals] = useState<Deal[] | null>(null)
  const [dealsError, setDealsError] = useState<string | null>(null)
  const [dealId, setDealId] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  // Loaded when the panel opens rather than with the page: listing deals spends
  // the customer's HubSpot API quota, and most page views never open a test.
  useEffect(() => {
    let cancelled = false
    fetch('/api/hubspot/deals')
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setDealsError(data.error ?? 'Could not load your HubSpot deals.')
          return
        }
        setDeals(data.deals ?? [])
        if (data.deals?.[0]) setDealId(data.deals[0].id)
      })
      .catch(() => {
        if (!cancelled) setDealsError('Could not load your HubSpot deals.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function runTest() {
    if (!dealId || running) return
    setRunning(true)
    setResult(null)
    setRunError(null)
    try {
      const res = await fetch(`/api/workflows/${workflowId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRunError(
          res.status === 429
            ? 'You have run several tests in the last few minutes. Wait a little and try again.'
            : data.error ?? 'The test could not run.'
        )
      } else {
        setResult(data as TestResult)
      }
    } catch {
      setRunError('The test could not run. Check your connection and try again.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div style={{ borderTop: '0.5px solid #E5E7EB', marginTop: '0.9rem', paddingTop: '0.9rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#0D0F1A' }}>Send a test</div>
        <button
          onClick={onClose}
          style={{ fontSize: 12, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          Close
        </button>
      </div>

      {/* Said before the button, not after: the customer should know what
          pressing it will send before they press it. */}
      <p style={{ fontSize: 13, color: '#6B7280', margin: '0.4rem 0 0.75rem', lineHeight: 1.5 }}>
        Runs this workflow now against a real deal. Slack messages, Notion rows and webhooks are sent
        for real, marked as a test. AI steps use your AI budget.
        {!enabled && ' This workflow is switched off — the test runs anyway.'}
      </p>

      {dealsError && <div style={{ fontSize: 13, color: '#991B1B' }}>{dealsError}</div>}
      {!deals && !dealsError && <div style={{ fontSize: 13, color: '#6B7280' }}>Loading your recent deals…</div>}
      {deals && deals.length === 0 && (
        <div style={{ fontSize: 13, color: '#6B7280' }}>There are no deals in your HubSpot account to test against.</div>
      )}

      {deals && deals.length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label htmlFor={`test-deal-${workflowId}`} style={{ fontSize: 13, color: '#374151' }}>
            Deal
          </label>
          <select
            id={`test-deal-${workflowId}`}
            value={dealId}
            onChange={(e) => setDealId(e.target.value)}
            disabled={running}
            style={{ fontSize: 13, padding: '0.35rem 0.5rem', border: '1px solid #E5E7EB', borderRadius: 6, maxWidth: '100%', flex: '1 1 220px' }}
          >
            {deals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.stage ? ` — ${d.stage}` : ''}
              </option>
            ))}
          </select>
          <button
            onClick={runTest}
            disabled={running || !dealId}
            style={{ fontSize: 13, fontWeight: 600, color: '#fff', background: running ? '#93C5FD' : '#1A56DB', border: 'none', borderRadius: 6, padding: '0.4rem 0.85rem', cursor: running ? 'default' : 'pointer' }}
          >
            {running ? 'Running…' : 'Run test'}
          </button>
        </div>
      )}

      {runError && <div style={{ ...box, fontSize: 13, color: '#991B1B', background: '#FEF2F2', borderColor: '#FECACA' }}>{runError}</div>}

      {result && <TestResultView result={result} />}
    </div>
  )
}

function TestResultView({ result }: { result: TestResult }) {
  return (
    <div style={box}>
      <div style={{ fontSize: 14, fontWeight: 600, color: result.ok ? '#166534' : '#991B1B', marginBottom: '0.5rem' }}>
        {result.ok ? '✓ Every step succeeded' : '✗ The test did not complete'} — {result.dealName}
      </div>

      {result.simulated.length > 0 && (
        <div style={{ fontSize: 12.5, color: '#374151', marginBottom: '0.5rem' }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Simulated for this test</div>
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {result.simulated.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {result.conditionNote && (
        <div style={{ fontSize: 12.5, color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, padding: '0.4rem 0.6rem', marginBottom: '0.5rem' }}>
          {result.conditionNote}
        </div>
      )}

      {result.error && <div style={{ fontSize: 13, color: '#991B1B', marginBottom: '0.5rem' }}>{result.error}</div>}

      <ol style={{ margin: 0, paddingLeft: '1.2rem', fontSize: 13 }}>
        {result.steps.map((s) => (
          <li key={s.index} style={{ marginBottom: '0.4rem' }}>
            <span style={{ color: '#0D0F1A' }}>{s.label}</span>{' '}
            <span style={{ color: s.status === 'success' ? '#166534' : s.status === 'failed' ? '#991B1B' : '#6B7280' }}>
              — {s.status === 'success' ? 'done' : s.status === 'failed' ? 'failed' : 'not run, because an earlier step failed'}
            </span>
            {s.error && <div style={{ color: '#991B1B', fontSize: 12.5, marginTop: 2 }}>{s.error}</div>}
            {s.output && (
              <details style={{ marginTop: 3 }}>
                <summary style={{ fontSize: 12.5, color: '#1A56DB', cursor: 'pointer' }}>Show what this step produced</summary>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 6, padding: '0.5rem', marginTop: 4, fontFamily: 'inherit' }}>
                  {s.output}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ol>

      <div style={{ fontSize: 12, color: '#6B7280', marginTop: '0.5rem' }}>
        Recorded in Activity as a test run.
      </div>
    </div>
  )
}
