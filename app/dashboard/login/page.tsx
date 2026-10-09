'use client'

import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

/**
 * Why someone was sent back here from a sign-in link.
 *
 * Read during render rather than in an effect: it is a value in the URL, not
 * something that changes, and deriving it here avoids a second render pass
 * showing nothing.
 */
function linkFailureMessage(): string {
  if (typeof window === 'undefined') return ''
  const code = new URLSearchParams(window.location.search).get('error')
  if (!code) return ''

  if (code === 'otp_expired' || code === 'access_denied') {
    return 'That sign-in link had already been used or had expired. Email security scanners sometimes open links before you get to them, which uses them up — a code typed in below cannot be consumed that way.'
  }
  return 'That sign-in link did not work. Request a new code below.'
}

export default function CustomerLoginPage() {
  const [email, setEmail]   = useState('')
  const [otp, setOtp]       = useState('')
  const [sent, setSent]     = useState(false)
  const [loading, setLoading] = useState(false)
  // Seeded from the URL so arriving from a dead link explains itself, rather
  // than presenting a bare sign-in form to someone who just clicked one.
  const [error, setError]   = useState(linkFailureMessage)

  async function handleSendCode() {
    setLoading(true)
    setError('')
    const { error } = await getSupabase().auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        // Where a link lands, if the email carries one. Without this Supabase
        // falls back to the project's site URL — the marketing homepage — which
        // has no idea what to do with an auth fragment, so both success and
        // failure ended up looking like a logged-out visitor.
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) setError(error.message)
    else setSent(true)
    setLoading(false)
  }

  async function handleVerifyCode() {
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth/customer/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Verification failed')
      setLoading(false)
    } else {
      window.location.href = '/dashboard'
    }
  }

  return (
    <main style={{ minHeight: '100vh', background: '#F9FAFB', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ background: '#fff', borderRadius: 16, border: '0.5px solid #E5E7EB', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', padding: '2rem', width: '100%', maxWidth: 360 }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1.75rem' }}>
          <div style={{ width: 28, height: 28, background: '#1A56DB', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: '#fff' }}>W</div>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#0D0F1A', letterSpacing: '-0.025em' }}>Workliq</span>
        </div>

        <h1 style={{ fontSize: 20, fontWeight: 600, color: '#0D0F1A', marginBottom: '0.35rem', letterSpacing: '-0.02em' }}>
          {sent ? 'Check your email' : 'Sign in to your dashboard'}
        </h1>
        <p style={{ fontSize: 14, color: '#6B7280', marginBottom: '1.5rem', lineHeight: 1.5 }}>
          {sent
            ? `We sent a 6-digit code to ${email}.`
            : 'Enter your email and we\'ll send you a sign-in code.'}
        </p>

        {!sent ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSendCode()}
              style={{ width: '100%', padding: '0.65rem 0.875rem', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
            />
            {error && <p style={{ fontSize: 13, color: '#DC2626', margin: 0 }}>{error}</p>}
            <button
              onClick={handleSendCode}
              disabled={loading || !email}
              style={{ padding: '0.7rem', background: '#1A56DB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: loading || !email ? 0.55 : 1 }}
            >
              {loading ? 'Sending…' : 'Send code'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input
              type="text"
              inputMode="numeric"
              placeholder="123456"
              value={otp}
              onChange={e => setOtp(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleVerifyCode()}
              maxLength={8}
              style={{ width: '100%', padding: '0.65rem 0.875rem', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 18, letterSpacing: '0.25em', textAlign: 'center', outline: 'none', boxSizing: 'border-box' }}
            />
            {error && <p style={{ fontSize: 13, color: '#DC2626', margin: 0 }}>{error}</p>}
            <button
              onClick={handleVerifyCode}
              disabled={loading || otp.length < 6}
              style={{ padding: '0.7rem', background: '#1A56DB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: loading || otp.length < 6 ? 0.55 : 1 }}
            >
              {loading ? 'Verifying…' : 'Sign in'}
            </button>
            <button
              onClick={() => { setSent(false); setOtp(''); setError('') }}
              style={{ background: 'none', border: 'none', fontSize: 13, color: '#9CA3AF', cursor: 'pointer', padding: '0.25rem' }}
            >
              Use a different email
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
