'use client'

import { useEffect, useState } from 'react'

// Where an emailed sign-in link lands.
//
// This page used to redirect every successful sign-in to /admin/waitlist — it
// was the admin callback and was never adapted for customers — and handled no
// error case at all. An expired or already-consumed link dropped the customer
// on the public marketing homepage with the reason visible only in the URL
// fragment, so a new customer saw a signup form and concluded they had no
// account.
//
// Supabase returns both outcomes in the fragment, which never reaches a server.
// So this reads it in the browser, posts tokens to the API — which verifies
// them and sets the HTTP-only cookies the application authenticates against —
// and sends failures back to the sign-in form carrying a reason.
//
// A failed link does not stop here. There is nothing to do on this page except
// go and ask for another code, so it goes there, with the explanation, rather
// than making the customer click again from a dead end.

export default function AuthCallbackPage() {
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))

    // Strip the fragment first. It carries either a live session or a failure
    // reason, and neither belongs in browser history or in a URL someone might
    // paste to ask what went wrong.
    window.history.replaceState(null, '', window.location.pathname)

    const errorCode = params.get('error_code') ?? params.get('error')
    if (errorCode) {
      window.location.replace(`/dashboard/login?error=${encodeURIComponent(errorCode)}`)
      return
    }

    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')

    if (!accessToken || !refreshToken) {
      // Nothing to act on — someone reached this page directly.
      window.location.replace('/dashboard/login')
      return
    }

    fetch('/api/auth/customer/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }),
    })
      .then(async (res) => {
        if (res.ok) {
          window.location.replace('/dashboard')
          return
        }
        const body = await res.json().catch(() => ({}))
        // The token was rejected rather than merely stale, so this is not a
        // "ask for another code" case in the way an expired link is.
        setFailure(body.error ?? 'That sign-in link did not work.')
      })
      .catch(() => {
        setFailure('We could not reach the server to finish signing you in.')
      })
  }, [])

  return (
    <main style={{ minHeight: '100vh', background: '#F9FAFB', fontFamily: 'system-ui, -apple-system, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
      <div style={{ background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 12, padding: '2rem', maxWidth: 420, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1.25rem' }}>
          <div style={{ width: 28, height: 28, background: '#1A56DB', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: '#fff' }}>W</div>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#0D0F1A', letterSpacing: '-0.025em' }}>Workliq</span>
        </div>

        {failure ? (
          <>
            <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.6, margin: '0 0 1.25rem' }}>{failure}</p>
            <a href="/dashboard/login" style={{ display: 'inline-block', fontSize: 14, fontWeight: 600, color: '#fff', background: '#1A56DB', borderRadius: 8, padding: '0.55rem 1.1rem', textDecoration: 'none' }}>
              Back to sign in
            </a>
          </>
        ) : (
          <p style={{ fontSize: 14, color: '#6B7280', margin: 0 }}>Signing you in…</p>
        )}
      </div>
    </main>
  )
}
