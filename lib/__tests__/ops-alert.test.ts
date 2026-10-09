import { describe, it, expect } from 'vitest'
import { buildOperatorEmail, type OperatorSignal } from '../ops-alert'

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
