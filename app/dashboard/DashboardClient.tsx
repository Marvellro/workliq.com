'use client'

import { useState, useEffect } from 'react'

type Flash = { type: 'success' | 'error'; message: string } | null

export type ConnectionHealth = { needsReauth: boolean; message: string | null }

type Props = {
  email: string
  hubspot: { hubId: string; health: ConnectionHealth } | null
  slack: { channelName: string; teamName: string; health: ConnectionHealth } | null
  notion: { workspaceName: string; health: ConnectionHealth } | null
  flash: Flash
}

export default function DashboardClient({ email, hubspot, slack, notion, flash }: Props) {
  // Every connection that needs the customer to act, in one list, so the
  // banner can be written once rather than three times.
  const broken = [
    hubspot?.health.needsReauth && {
      name: 'HubSpot',
      href: '/api/auth/hubspot',
      message: hubspot.health.message,
    },
    slack?.health.needsReauth && {
      name: 'Slack',
      href: '/api/auth/slack',
      message: slack.health.message,
    },
    notion?.health.needsReauth && {
      name: 'Notion',
      href: '/api/auth/notion',
      message: notion.health.message,
    },
  ].filter(Boolean) as { name: string; href: string; message: string | null }[]

  const [flashVisible, setFlashVisible] = useState(!!flash)
  const [slackTestState, setSlackTestState] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')
  const [notionTestState, setNotionTestState] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')

  useEffect(() => {
    if (!flash) return
    setFlashVisible(true)
    const t = setTimeout(() => setFlashVisible(false), 5000)
    return () => clearTimeout(t)
  }, [flash])

  async function handleLogout() {
    await fetch('/api/auth/customer/logout', { method: 'POST' })
    window.location.href = '/dashboard/login'
  }

  async function handleSlackTest() {
    setSlackTestState('loading')
    try {
      const res = await fetch('/api/slack/test', { method: 'POST' })
      setSlackTestState(res.ok ? 'sent' : 'error')
    } catch {
      setSlackTestState('error')
    }
    setTimeout(() => setSlackTestState('idle'), 4000)
  }

  async function handleNotionTest() {
    setNotionTestState('loading')
    try {
      const res = await fetch('/api/notion/test', { method: 'POST' })
      setNotionTestState(res.ok ? 'sent' : 'error')
    } catch {
      setNotionTestState('error')
    }
    setTimeout(() => setNotionTestState('idle'), 4000)
  }

  return (
    <main style={{ minHeight: '100vh', background: '#F9FAFB', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Nav */}
      <nav style={{ background: '#fff', borderBottom: '0.5px solid #E5E7EB', padding: '0 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, background: '#1A56DB', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: '#fff' }}>W</div>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#0D0F1A', letterSpacing: '-0.025em' }}>Workliq</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <a href="/dashboard/workflows" style={{ fontSize: 13, color: '#374151', textDecoration: 'none', border: '1px solid #E5E7EB', borderRadius: 6, padding: '0.35rem 0.75rem' }}>
            Workflows
          </a>
          <a href="/dashboard/settings" style={{ fontSize: 13, color: '#374151', textDecoration: 'none', border: '1px solid #E5E7EB', borderRadius: 6, padding: '0.35rem 0.75rem' }}>
            Settings
          </a>
          <span style={{ fontSize: 13, color: '#6B7280' }}>{email}</span>
          <button
            onClick={handleLogout}
            style={{ fontSize: 13, color: '#6B7280', background: 'none', border: '1px solid #E5E7EB', borderRadius: 6, padding: '0.35rem 0.75rem', cursor: 'pointer' }}
          >
            Sign out
          </button>
        </div>
      </nav>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '2.5rem 1.5rem' }}>
        {/* ── Broken connection banner ──────────────────────────────────────
            Unlike the flash above, this does NOT auto-dismiss. It describes a
            state that persists until the customer acts, and a warning that
            disappears after five seconds is a warning they can miss. */}
        {broken.length > 0 && (
          <div style={{
            background: '#FFFBEB',
            border: '1px solid #FDE68A',
            borderRadius: 12,
            padding: '1rem 1.25rem',
            marginBottom: '1.5rem',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#92400E', marginBottom: broken.length > 1 ? '0.75rem' : '0.5rem' }}>
              {broken.length === 1
                ? `${broken[0].name} needs reconnecting`
                : `${broken.length} connections need reconnecting`}
            </div>

            {broken.map((c) => (
              <div key={c.name} style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
                <div style={{ fontSize: 13, color: '#78350F', lineHeight: 1.5 }}>
                  {c.message ?? `Reconnect ${c.name} to resume the workflows that use it.`}
                </div>
                <a
                  href={c.href}
                  style={{ fontSize: 13, fontWeight: 600, color: '#fff', background: '#B45309', borderRadius: 6, padding: '0.4rem 0.85rem', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  Reconnect {c.name}
                </a>
              </div>
            ))}
          </div>
        )}

        {/* Flash banner */}
        {flash && flashVisible && (
          <div style={{
            padding: '0.75rem 1rem',
            borderRadius: 8,
            marginBottom: '1.5rem',
            fontSize: 14,
            background: flash.type === 'success' ? '#F0FDF4' : '#FEF2F2',
            color: flash.type === 'success' ? '#166534' : '#991B1B',
            border: `1px solid ${flash.type === 'success' ? '#BBF7D0' : '#FECACA'}`,
          }}>
            {flash.type === 'success' ? '✓ ' : '⚠ '}{flash.message}
          </div>
        )}

        <h1 style={{ fontSize: 22, fontWeight: 600, color: '#0D0F1A', marginBottom: '0.4rem', letterSpacing: '-0.02em' }}>
          Connections
        </h1>
        <p style={{ fontSize: 14, color: '#6B7280', marginBottom: '2rem' }}>
          Connect your tools to enable Workliq automations.
        </p>

        {/* ── HubSpot card ── */}
        <ConnectionCard
          logo={{ bg: '#FF7A59', letter: 'H' }}
          name="HubSpot"
          subtitle={hubspot ? `Portal ${hubspot.hubId}` : 'Not connected'}
          connected={!!hubspot}
          needsReauth={!!hubspot?.health.needsReauth}
          connectHref="/api/auth/hubspot"
          connectLabel="Connect HubSpot"
        />

        {/* ── Slack card ── */}
        <IntegrationCard
          logo={{ bg: '#4A154B', letter: 'S' }}
          name="Slack"
          subtitle={
            slack ? `${slack.channelName} in ${slack.teamName}` : 'Not connected'
          }
          connected={!!slack}
          needsReauth={!!slack?.health.needsReauth}
          connectHref="/api/auth/slack"
          connectLabel="Add to Slack"
          testState={slackTestState}
          onTest={handleSlackTest}
          testHint={slack ? `Posts a confirmation message to ${slack.channelName}` : ''}
          style={{ marginTop: '0.75rem' }}
        />

        {/* ── Notion card ── */}
        <IntegrationCard
          logo={{ bg: '#0D0F1A', letter: 'N' }}
          name="Notion"
          subtitle={
            notion
              ? `${notion.workspaceName} · Stale Deals database ready`
              : 'Not connected'
          }
          connected={!!notion}
          needsReauth={!!notion?.health.needsReauth}
          connectHref="/api/auth/notion"
          connectLabel="Connect Notion"
          testState={notionTestState}
          onTest={handleNotionTest}
          testHint="Adds a sample row to your Workliq Stale Deals database"
          style={{ marginTop: '0.75rem' }}
        />
      </div>
    </main>
  )
}

// ── ConnectionCard: simple card with no sub-actions (HubSpot) ─────────────────
function ConnectionCard({
  logo,
  name,
  subtitle,
  connected,
  needsReauth,
  connectHref,
  connectLabel,
}: {
  logo: { bg: string; letter: string }
  name: string
  subtitle: string
  connected: boolean
  needsReauth: boolean
  connectHref: string
  connectLabel: string
}) {
  return (
    <div style={{ background: '#fff', border: `0.5px solid ${needsReauth ? '#FDE68A' : '#E5E7EB'}`, borderRadius: 12, padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
      <CardLogo logo={logo} name={name} subtitle={subtitle} />
      <CardActions connected={connected} needsReauth={needsReauth} connectHref={connectHref} connectLabel={connectLabel} />
    </div>
  )
}

// ── IntegrationCard: card with a "Send test" sub-action (Slack, Notion) ───────
function IntegrationCard({
  logo,
  name,
  subtitle,
  connected,
  needsReauth,
  connectHref,
  connectLabel,
  testState,
  onTest,
  testHint,
  style,
}: {
  logo: { bg: string; letter: string }
  name: string
  subtitle: string
  connected: boolean
  needsReauth: boolean
  connectHref: string
  connectLabel: string
  testState: 'idle' | 'loading' | 'sent' | 'error'
  onTest: () => void
  testHint: string
  style?: React.CSSProperties
}) {
  return (
    <div style={{ background: '#fff', border: `0.5px solid ${needsReauth ? '#FDE68A' : '#E5E7EB'}`, borderRadius: 12, padding: '1.25rem 1.5rem', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
        <CardLogo logo={logo} name={name} subtitle={subtitle} />
        <CardActions connected={connected} needsReauth={needsReauth} connectHref={connectHref} connectLabel={connectLabel} />
      </div>

      {connected && (
        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '0.5px solid #F3F4F6', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            onClick={onTest}
            disabled={testState === 'loading'}
            style={{
              fontSize: 13,
              fontWeight: 500,
              color:
                testState === 'sent'  ? '#166534' :
                testState === 'error' ? '#991B1B' : '#374151',
              background: 'none',
              border: '1px solid #E5E7EB',
              borderRadius: 6,
              padding: '0.4rem 0.875rem',
              cursor: testState === 'loading' ? 'default' : 'pointer',
              opacity: testState === 'loading' ? 0.6 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            {testState === 'loading' && 'Sending…'}
            {testState === 'sent'    && '✓ Sent'}
            {testState === 'error'   && '⚠ Failed — try again'}
            {testState === 'idle'    && 'Send test'}
          </button>
          <span style={{ fontSize: 12, color: '#9CA3AF' }}>{testHint}</span>
        </div>
      )}
    </div>
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function CardLogo({
  logo,
  name,
  subtitle,
}: {
  logo: { bg: string; letter: string }
  name: string
  subtitle: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
      <div style={{ width: 40, height: 40, borderRadius: 8, background: logo.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{logo.letter}</span>
      </div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#0D0F1A', letterSpacing: '-0.01em' }}>{name}</div>
        <div style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>{subtitle}</div>
      </div>
    </div>
  )
}

function CardActions({
  connected,
  needsReauth,
  connectHref,
  connectLabel,
}: {
  connected: boolean
  needsReauth: boolean
  connectHref: string
  connectLabel: string
}) {
  // A flagged connection must not read as "Connected" in green. The row still
  // exists, so the old code showed exactly that while every workflow using it
  // failed — the single most misleading thing the dashboard could say.
  if (connected && needsReauth) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 20, padding: '0.25rem 0.65rem' }}>
          Needs attention
        </span>
        <a
          href={connectHref}
          style={{ fontSize: 13, fontWeight: 600, color: '#fff', background: '#B45309', borderRadius: 6, padding: '0.35rem 0.75rem', textDecoration: 'none' }}
        >
          Reconnect
        </a>
      </div>
    )
  }

  if (connected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#166534', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 20, padding: '0.25rem 0.65rem' }}>
          Connected
        </span>
        <a
          href={connectHref}
          style={{ fontSize: 13, color: '#6B7280', textDecoration: 'none', border: '1px solid #E5E7EB', borderRadius: 6, padding: '0.35rem 0.75rem' }}
        >
          Reconnect
        </a>
      </div>
    )
  }

  return (
    <a
      href={connectHref}
      style={{ fontSize: 14, fontWeight: 600, color: '#fff', background: '#1A56DB', borderRadius: 8, padding: '0.55rem 1.1rem', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}
    >
      {connectLabel}
    </a>
  )
}
