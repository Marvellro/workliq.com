import { describe, it, expect } from 'vitest'
import { buildOperatorEmail, signalsFromSnapshot, type OperatorSignal } from '../ops-alert'

// What an operator actually receives. The judgement being tested is which
// condition owns the subject line, because that decides whether someone opens
// it now or after dinner.

const stalled: OperatorSignal = {
  key: 'queue_stalled',
  severity: 'critical',
  headline: '4 jobs overdue by more than 6 hours',
  detail: 'Work is queued and nothing is running it.',
}

const rejections: OperatorSignal = {
  key: 'webhook_rejections',
  severity: 'warning',
  headline: '2 webhooks rejected in the last 24 hours',
  detail: 'Signature verification failed.',
}

describe('buildOperatorEmail', () => {
  it('leads with the critical condition, not the first one found', () => {
    // Collection order is whatever the queries happen to run in. Severity is
    // the thing that should decide the subject.
    const { subject } = buildOperatorEmail([rejections, stalled])
    expect(subject).toBe('[Workliq] 4 jobs overdue by more than 6 hours')
  })

  it('falls back to the first signal when nothing is critical', () => {
    expect(buildOperatorEmail([rejections]).subject).toBe(
      '[Workliq] 2 webhooks rejected in the last 24 hours'
    )
  })

  it('includes every signal, not only the one in the subject', () => {
    const { html, text } = buildOperatorEmail([stalled, rejections])
    for (const body of [html, text]) {
      expect(body).toContain('4 jobs overdue')
      expect(body).toContain('2 webhooks rejected')
    }
  })

  it('carries the detail, which is the part that says what to do', () => {
    const { html, text } = buildOperatorEmail([stalled])
    for (const body of [html, text]) {
      expect(body).toContain('Work is queued and nothing is running it.')
    }
  })

  it('marks severity so a warning does not read like an outage', () => {
    const { text } = buildOperatorEmail([stalled, rejections])
    expect(text).toContain('CRITICAL:')
    expect(text).toContain('WARNING:')
  })

  it('says why it arrived and how often it will repeat', () => {
    // An unexplained alert that fires repeatedly is one someone filters away.
    const { html, text } = buildOperatorEmail([stalled])
    for (const body of [html, text]) {
      expect(body).toMatch(/customers cannot fix themselves/)
      expect(body).toMatch(/once per 24 hours/)
    }
  })

  it('escapes text that came from a database value', () => {
    const { html } = buildOperatorEmail([
      { ...stalled, headline: '<script>alert(1)</script> & "x"' },
    ])
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('runOperatorAlert result shape', () => {
  it('distinguishes "not configured" from "nothing wrong"', async () => {
    // Both used to report zeros. An unconfigured deployment and a healthy one
    // looking identical is the failure this module exists to prevent, applied
    // to the module itself.
    const { runOperatorAlert } = await import('../ops-alert')
    const before = process.env.OPS_ALERT_EMAIL
    delete process.env.OPS_ALERT_EMAIL

    const result = await runOperatorAlert()
    expect(result.configured).toBe(false)

    if (before !== undefined) process.env.OPS_ALERT_EMAIL = before
  })
})

describe('signalsFromSnapshot', () => {
  // Pure, deliberately. The first version of these called the real collector,
  // which reads the live database — so they needed production credentials and
  // would have failed on any clean checkout. They passed locally only because
  // the shell that ran them happened to have .env.local sourced.

  const clear = {
    overdueJobs: 0,
    webhookRejections24h: 0,
    accountsWithBrokenConnections: 0,
    deadJobs: 0,
  }

  it('raises nothing when everything is clear', () => {
    expect(signalsFromSnapshot(clear)).toEqual([])
  })

  it('agrees in number for a single job', () => {
    // Read off the ops_alerts rows a real alert produced: "1 job were overdue"
    // and "1 job exhausted their retries". Both pluralised the noun and left
    // the verb alone. An alert that cannot count to one stops being believed.
    const [stalled] = signalsFromSnapshot({ ...clear, overdueJobs: 1 })
    expect(stalled.headline).toBe('1 job was overdue by more than 6 hours')

    const [dead] = signalsFromSnapshot({ ...clear, deadJobs: 1 })
    expect(dead.headline).toBe('1 job exhausted its retries')
  })

  it('agrees in number for several', () => {
    expect(signalsFromSnapshot({ ...clear, overdueJobs: 4 })[0].headline).toBe(
      '4 jobs were overdue by more than 6 hours'
    )
    expect(signalsFromSnapshot({ ...clear, deadJobs: 3 })[0].headline).toBe(
      '3 jobs exhausted their retries'
    )
  })

  it('stays quiet about one account losing a connection', () => {
    // That customer already has an email about it. Repeating it here is how a
    // channel earns itself a filter rule.
    expect(signalsFromSnapshot({ ...clear, accountsWithBrokenConnections: 1 })).toEqual([])
  })

  it('speaks up when several accounts break at once', () => {
    // Simultaneous failures point at our configuration, not theirs, and
    // nobody is going to report that.
    const [signal] = signalsFromSnapshot({ ...clear, accountsWithBrokenConnections: 3 })
    expect(signal.key).toBe('connections_broken_widely')
    expect(signal.severity).toBe('critical')
  })

  it('reports every condition present, not just the worst', () => {
    const signals = signalsFromSnapshot({
      overdueJobs: 2,
      webhookRejections24h: 5,
      accountsWithBrokenConnections: 2,
      deadJobs: 1,
    })
    expect(signals.map((s) => s.key)).toEqual([
      'queue_stalled',
      'webhook_rejections',
      'connections_broken_widely',
      'dead_jobs',
    ])
  })
})
