import { describe, it, expect } from 'vitest'
import { buildDigestEmail, type CustomerDigest } from '../notify'

// The digest is the only message Workliq sends a customer unprompted, so what
// it says matters as much as whether it sends. These assert the copy a customer
// actually receives rather than that a mail client was called.

function digest(over: Partial<CustomerDigest> = {}): CustomerDigest {
  return {
    customerId: 'c-1',
    email: 'someone@example.com',
    connections: [],
    pausedWorkflows: [],
    plan: null,
    deadJobs: [],
    ...over,
  }
}

const HUBSPOT_BROKEN = {
  provider: 'hubspot' as const,
  message: 'Your HubSpot connection is no longer valid — reconnect HubSpot.',
  brokenAt: '2026-09-19T10:00:00.000Z',
}

const SLACK_BROKEN = {
  provider: 'slack' as const,
  message: 'Your Slack connection is no longer valid — reconnect Slack.',
  brokenAt: '2026-09-19T10:05:00.000Z',
}

function job(over: Partial<CustomerDigest['deadJobs'][number]> = {}) {
  return {
    id: 'j-1',
    kind: 'workflow.action',
    workflowName: 'Deal stage change',
    createdAt: '2026-09-19T09:00:00.000Z',
    ...over,
  }
}

describe('subject', () => {
  it('names the tool when one connection broke', () => {
    // The tool name is what makes this recognisable in a full inbox, and it is
    // the one word that tells them where to go.
    const { subject } = buildDigestEmail(digest({ connections: [HUBSPOT_BROKEN] }))
    expect(subject).toBe('Action needed: your HubSpot connection stopped working')
  })

  it('counts them when several broke', () => {
    const { subject } = buildDigestEmail(
      digest({ connections: [HUBSPOT_BROKEN, SLACK_BROKEN] })
    )
    expect(subject).toBe('Action needed: 2 Workliq connections stopped working')
  })

  it('leads with the connection even when jobs also died', () => {
    // A dead grant produces both. The connection is the cause and the only part
    // the customer can act on, so it owns the subject line.
    const { subject } = buildDigestEmail(
      digest({ connections: [HUBSPOT_BROKEN], deadJobs: [job(), job({ id: 'j-2' })] })
    )
    expect(subject).toMatch(/^Action needed: your HubSpot/)
  })

  it('falls back to the failure count with no broken connection', () => {
    expect(buildDigestEmail(digest({ deadJobs: [job()] })).subject).toBe(
      '1 Workliq automation did not run'
    )
    expect(
      buildDigestEmail(digest({ deadJobs: [job(), job({ id: 'j-2' })] })).subject
    ).toBe('2 Workliq automations did not run')
  })
})

describe('body', () => {
  it('shows the reason and a reconnect link', () => {
    const { html, text } = buildDigestEmail(digest({ connections: [HUBSPOT_BROKEN] }))
    expect(html).toContain('reconnect HubSpot')
    expect(html).toContain('/dashboard')
    expect(text).toContain('reconnect HubSpot')
    expect(text).toContain('/dashboard')
  })

  it('names the workflow rather than the job kind', () => {
    // "Deal stage change didn't run" is actionable. "workflow.action failed"
    // is an implementation detail the customer never chose.
    const { html } = buildDigestEmail(digest({ deadJobs: [job()] }))
    expect(html).toContain('Deal stage change')
    expect(html).not.toContain('workflow.action')
  })

  it('falls back to something readable when the workflow is gone', () => {
    const { html } = buildDigestEmail(
      digest({ deadJobs: [job({ kind: 'hubspot.event', workflowName: null })] })
    )
    expect(html).toContain('A HubSpot event')
  })

  it('caps the list and says how many were left out', () => {
    // A digest that lists forty failures is not a digest.
    const many = Array.from({ length: 9 }, (_, i) =>
      job({ id: `j-${i}`, workflowName: `Workflow ${i}` })
    )
    const { html, text } = buildDigestEmail(digest({ deadJobs: many }))
    expect(html).toContain('Workflow 0')
    expect(html).toContain('Workflow 4')
    expect(html).not.toContain('Workflow 5')
    expect(html).toContain('and 4 more')
    expect(text).toContain('and 4 more')
  })

  it('omits a section entirely when it has nothing in it', () => {
    const onlyConnections = buildDigestEmail(digest({ connections: [HUBSPOT_BROKEN] }))
    expect(onlyConnections.html).not.toContain('did not run')

    const onlyJobs = buildDigestEmail(digest({ deadJobs: [job()] }))
    expect(onlyJobs.html).not.toContain('Needs reconnecting')
  })

  it('escapes provider text before putting it in HTML', () => {
    // last_error originates in a third-party error response. It is displayed,
    // so it is escaped — an unescaped angle bracket would at best break the
    // layout of a message we cannot re-send.
    const { html } = buildDigestEmail(
      digest({
        connections: [
          { ...HUBSPOT_BROKEN, message: 'broke <script>alert(1)</script> & "quoted"' },
        ],
      })
    )
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
    expect(html).toContain('&quot;')
  })

  it('always explains why the email arrived', () => {
    // Unprompted mail that does not say why it was sent reads as spam.
    for (const d of [digest({ connections: [HUBSPOT_BROKEN] }), digest({ deadJobs: [job()] })]) {
      const { html, text } = buildDigestEmail(d)
      expect(html).toMatch(/only send this when there is an action to take/)
      expect(text).toMatch(/only send this when there is an action to take/)
    }
  })
})

describe('paused workflows', () => {
  const paused = [
    { id: 'w1', name: 'Deal stage change', pausedAt: '2026-10-08T10:00:00.000Z' },
    { id: 'w2', name: 'Stale deal follow-up', pausedAt: '2026-10-08T10:00:00.000Z' },
  ]

  it('leads the subject when nothing is broken', () => {
    expect(buildDigestEmail(digest({ pausedWorkflows: [paused[0]] })).subject).toBe(
      'A Workliq workflow was paused by your plan change'
    )
    expect(buildDigestEmail(digest({ pausedWorkflows: paused })).subject).toBe(
      '2 Workliq workflows were paused by your plan change'
    )
  })

  it('still yields to a broken connection', () => {
    // A dead credential stops everything; a paused workflow is a consequence of
    // a billing change the customer already made. The cause owns the subject.
    const { subject } = buildDigestEmail(
      digest({ connections: [HUBSPOT_BROKEN], pausedWorkflows: paused })
    )
    expect(subject).toMatch(/^Action needed: your HubSpot/)
  })

  it('names each workflow and says nothing was deleted', () => {
    // A workflow that stops firing looks exactly like one with nothing to fire
    // on. This is the only category the customer cannot discover by looking.
    const { html, text } = buildDigestEmail(digest({ pausedWorkflows: paused }))
    for (const body of [html, text]) {
      expect(body).toContain('Deal stage change')
      expect(body).toContain('Stale deal follow-up')
      expect(body).toMatch(/Nothing was deleted/)
    }
  })

  it('explains which ones were kept', () => {
    // The rule has to be stated, or the choice looks arbitrary.
    const { html, text } = buildDigestEmail(digest({ pausedWorkflows: paused }))
    expect(html).toMatch(/oldest were kept/)
    expect(text).toMatch(/oldest were kept/)
  })

  it('escapes a workflow name', () => {
    // Workflow names are customer-written free text going into HTML mail.
    const { html } = buildDigestEmail(
      digest({ pausedWorkflows: [{ ...paused[0], name: '<script>x</script> & "q"' }] })
    )
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('paused workflows: naming the limit', () => {
  // Found by reading the real email: it said "your plan allows fewer active
  // workflows than you had running" and never said how many it does allow,
  // which plan that is, or what to do about it. It invited the question it
  // refused to answer.
  const paused = [{ id: 'w1', name: 'Nightly digest', pausedAt: '2026-10-09T14:47:00.000Z' }]

  it('names the plan and the allowance', () => {
    const { html, text } = buildDigestEmail(
      digest({ pausedWorkflows: paused, plan: { label: 'Free', maxWorkflows: 1 } })
    )
    for (const body of [html, text]) {
      expect(body).toContain('Free')
      expect(body).toMatch(/1 active workflow\b/)
    }
  })

  it('pluralises the allowance', () => {
    const { text } = buildDigestEmail(
      digest({ pausedWorkflows: paused, plan: { label: 'Starter', maxWorkflows: 10 } })
    )
    expect(text).toMatch(/10 active workflows/)
  })

  it('says how to get them back', () => {
    const { html, text } = buildDigestEmail(
      digest({ pausedWorkflows: paused, plan: { label: 'Free', maxWorkflows: 1 } })
    )
    for (const body of [html, text]) {
      expect(body).toMatch(/upgrade/i)
      expect(body).toContain('/pricing')
    }
  })

  it('offers a destination that works whatever state the account is in', () => {
    // The workflows page redirects away when HubSpot is not connected, so an
    // email whose only link went there could dead-end. /pricing always loads.
    const { html } = buildDigestEmail(
      digest({ pausedWorkflows: paused, plan: { label: 'Free', maxWorkflows: 1 } })
    )
    expect(html).toContain('/pricing')
    expect(html).toContain('/dashboard/workflows')
  })

  it('still reads sensibly when the plan could not be resolved', () => {
    // getEntitlements falls back to free on any error, but the lookup itself
    // can fail — the email must not render a gap where a number should be.
    const { html, text } = buildDigestEmail(digest({ pausedWorkflows: paused, plan: null }))
    for (const body of [html, text]) {
      expect(body).toMatch(/fewer active workflows than you had running/)
      expect(body).not.toMatch(/undefined|null|NaN/)
    }
  })
})
