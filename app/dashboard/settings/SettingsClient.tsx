'use client'

import { useState } from 'react'

type Plan = {
  id: 'free' | 'starter' | 'growth'
  label: string
  maxWorkflows: number
  aiBudgetUsd: number
  workflowsUsed: number
  aiSpentUsd: number
}

type Subscription = {
  status: string
  billingPeriod: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  manageable: boolean
}

type Props = {
  email: string
  plan: Plan
  subscription: Subscription | null
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default function SettingsClient({ email, plan, subscription }: Props) {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function openBilling() {
    setOpening(true)
    setError(null)
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.url) {
        setError(body.error ?? 'Could not open billing management.')
        setOpening(false)
        return
      }
      // Stripe hosts the portal; leaving the app is the point.
      window.location.href = body.url
    } catch {
      setError('Could not reach billing. Please try again.')
      setOpening(false)
    }
  }

  async function deleteAccount() {
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: confirmText }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setDeleteError(body.error ?? 'The account could not be deleted.')
        setDeleting(false)
        return
      }
      // The session is gone server-side; a full navigation drops any client
      // state with it rather than leaving a dead dashboard on screen.
      window.location.href = '/'
    } catch {
      setDeleteError('Could not reach the server. Nothing was deleted.')
      setDeleting(false)
    }
  }

  const card: React.CSSProperties = {
    background: '#fff',
    border: '0.5px solid #E5E7EB',
    borderRadius: 12,
    padding: '1.25rem 1.5rem',
    marginBottom: '0.75rem',
  }
  const label: React.CSSProperties = { fontSize: 12, color: '#6B7280', marginBottom: 3 }
  const value: React.CSSProperties = { fontSize: 15, color: '#0D0F1A', fontWeight: 500 }

  return (
    <main style={{ minHeight: '100vh', background: '#F9FAFB', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <nav style={{ background: '#fff', borderBottom: '0.5px solid #E5E7EB', padding: '0 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, background: '#1A56DB', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: '#fff' }}>W</div>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#0D0F1A', letterSpacing: '-0.025em' }}>Workliq</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <a href="/dashboard" style={{ fontSize: 13, color: '#6B7280', textDecoration: 'none', border: '1px solid #E5E7EB', borderRadius: 6, padding: '0.35rem 0.75rem' }}>Connections</a>
          <a href="/dashboard/workflows" style={{ fontSize: 13, color: '#6B7280', textDecoration: 'none', border: '1px solid #E5E7EB', borderRadius: 6, padding: '0.35rem 0.75rem' }}>Workflows</a>
          <a href="/dashboard/activity" style={{ fontSize: 13, color: '#6B7280', textDecoration: 'none', border: '1px solid #E5E7EB', borderRadius: 6, padding: '0.35rem 0.75rem' }}>Activity</a>
        </div>
      </nav>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '2.5rem 1.5rem' }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: '#0D0F1A', marginBottom: '0.4rem', letterSpacing: '-0.02em' }}>Settings</h1>
        <p style={{ fontSize: 14, color: '#6B7280', marginBottom: '2rem' }}>Your account and subscription.</p>

        {/* ── Account ── */}
        <h2 style={{ fontSize: 13, fontWeight: 600, color: '#6B7280', letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: '0.6rem' }}>Account</h2>
        <div style={card}>
          <div style={label}>Signed in as</div>
          <div style={value}>{email}</div>
        </div>

        {/* ── Plan ── */}
        <h2 style={{ fontSize: 13, fontWeight: 600, color: '#6B7280', letterSpacing: '.04em', textTransform: 'uppercase', margin: '1.75rem 0 0.6rem' }}>Plan</h2>
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <div style={label}>Current plan</div>
              <div style={{ ...value, fontSize: 17 }}>
                {plan.label}
                {subscription?.billingPeriod && (
                  <span style={{ fontSize: 13, fontWeight: 400, color: '#6B7280' }}> · billed {subscription.billingPeriod}</span>
                )}
              </div>
            </div>
            {plan.id === 'free' && (
              <a href="/pricing" style={{ fontSize: 13, fontWeight: 600, color: '#fff', background: '#1A56DB', borderRadius: 6, padding: '0.4rem 0.85rem', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                Upgrade
              </a>
            )}
          </div>

          <div style={{ display: 'flex', gap: '2.5rem', flexWrap: 'wrap', paddingTop: '1rem', borderTop: '0.5px solid #F3F4F6' }}>
            <div>
              <div style={label}>Active workflows</div>
              <div style={value}>{plan.workflowsUsed} <span style={{ color: '#9CA3AF', fontWeight: 400 }}>of {plan.maxWorkflows}</span></div>
            </div>
            <div>
              <div style={label}>AI usage this month</div>
              <div style={value}>
                ${plan.aiSpentUsd.toFixed(2)} <span style={{ color: '#9CA3AF', fontWeight: 400 }}>of ${plan.aiBudgetUsd.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Billing ── */}
        <h2 style={{ fontSize: 13, fontWeight: 600, color: '#6B7280', letterSpacing: '.04em', textTransform: 'uppercase', margin: '1.75rem 0 0.6rem' }}>Billing</h2>
        <div style={card}>
          {subscription?.manageable ? (
            <>
              <div style={{ display: 'flex', gap: '2.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                <div>
                  <div style={label}>Status</div>
                  <div style={value}>{subscription.cancelAtPeriodEnd ? 'Cancels at period end' : subscription.status}</div>
                </div>
                <div>
                  <div style={label}>{subscription.cancelAtPeriodEnd ? 'Access until' : 'Renews on'}</div>
                  <div style={value}>{formatDate(subscription.currentPeriodEnd)}</div>
                </div>
              </div>

              <button
                onClick={openBilling}
                disabled={opening}
                style={{ fontSize: 14, fontWeight: 600, color: '#fff', background: '#1A56DB', borderRadius: 8, padding: '0.55rem 1.1rem', border: 'none', cursor: opening ? 'default' : 'pointer', opacity: opening ? 0.7 : 1 }}
              >
                {opening ? 'Opening…' : 'Manage subscription'}
              </button>
              <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: '0.6rem' }}>
                Opens Stripe, where you can update your payment method, download
                invoices, or cancel. Cancelling keeps your access until the end of
                the period you have already paid for.
              </p>
            </>
          ) : (
            <p style={{ fontSize: 14, color: '#6B7280', margin: 0 }}>
              {plan.id === 'free'
                ? 'You are on the free plan, so there is nothing to bill. Upgrading starts a subscription you can manage from here.'
                : 'This plan was granted directly rather than through a Stripe subscription, so there is nothing to manage here. Contact support to change it.'}
            </p>
          )}

          {error && (
            <div style={{ fontSize: 13, color: '#991B1B', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '0.6rem 0.85rem', marginTop: '0.85rem' }}>
              {error}
            </div>
          )}
        </div>

        {/* ── Export ── */}
        <h2 style={{ fontSize: 13, fontWeight: 600, color: '#6B7280', letterSpacing: '.04em', textTransform: 'uppercase', margin: '1.75rem 0 0.6rem' }}>Your data</h2>
        <div style={card}>
          <p style={{ fontSize: 14, color: '#374151', margin: '0 0 0.85rem', lineHeight: 1.6 }}>
            Download everything this account holds as JSON: your workflows, run
            history, AI usage, connection details and security log.
          </p>
          <a
            href="/api/account/export"
            style={{ display: 'inline-block', fontSize: 14, fontWeight: 600, color: '#374151', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: '0.55rem 1.1rem', textDecoration: 'none' }}
          >
            Download my data
          </a>
          <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: '0.6rem' }}>
            Credentials are left out on purpose — OAuth tokens, your Slack
            webhook URL and your webhook signing secret. A downloaded file is not
            a safe place to keep them.
          </p>
        </div>

        {/* ── Delete account ── */}
        <h2 style={{ fontSize: 13, fontWeight: 600, color: '#991B1B', letterSpacing: '.04em', textTransform: 'uppercase', margin: '1.75rem 0 0.6rem' }}>
          Delete account
        </h2>
        <div style={{ ...card, border: '1px solid #FECACA' }}>
          <p style={{ fontSize: 14, color: '#374151', margin: '0 0 0.85rem', lineHeight: 1.6 }}>
            This removes your account and everything in it: your HubSpot, Slack
            and Notion connections and their stored tokens, every workflow, your
            run history including any text an AI step produced, and your queued
            work. It cannot be undone.
          </p>
          {subscription?.manageable && (
            <p style={{ fontSize: 14, color: '#991B1B', margin: '0 0 0.85rem', lineHeight: 1.6 }}>
              Your subscription is cancelled first, immediately. You will not be
              billed again, and the remainder of the period you have already paid
              for is not refunded. If you would rather keep access until it ends,
              cancel from Manage subscription above and delete later.
            </p>
          )}
          <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 1rem', lineHeight: 1.6 }}>
            Your billing records are kept for 7 years to meet financial reporting
            obligations, as described in our{' '}
            <a href="/privacy" style={{ color: '#1A56DB' }}>privacy policy</a>.
            Nothing else is retained.
          </p>

          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: '0.375rem' }}>
            Type DELETE to confirm
          </label>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            style={{ width: 200, fontSize: 14, color: '#0D0F1A', border: '1px solid #E5E7EB', borderRadius: 8, padding: '0.55rem 0.75rem', marginRight: '0.6rem', boxSizing: 'border-box' }}
          />
          <button
            onClick={deleteAccount}
            disabled={confirmText !== 'DELETE' || deleting}
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: '#fff',
              background: confirmText === 'DELETE' ? '#A4161A' : '#E5E7EB',
              borderRadius: 8,
              padding: '0.55rem 1.1rem',
              border: 'none',
              cursor: confirmText === 'DELETE' && !deleting ? 'pointer' : 'default',
            }}
          >
            {deleting ? 'Deleting…' : 'Delete my account'}
          </button>

          {deleteError && (
            <div style={{ fontSize: 13, color: '#991B1B', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '0.6rem 0.85rem', marginTop: '0.85rem' }}>
              {deleteError}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
