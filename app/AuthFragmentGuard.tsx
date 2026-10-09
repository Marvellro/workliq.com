'use client'

import { useEffect } from 'react'

// Catches a Supabase auth error that lands somewhere it was never sent.
//
// When a sign-in link is valid, Supabase honours emailRedirectTo and the
// customer arrives at /auth/callback. When the token is expired or already
// used, it cannot recover the redirect target from the token, so it falls back
// to the project's Site URL — which is the marketing homepage, a page with no
// idea what an auth fragment is.
//
// So the error that matters most is the one delivered to the page least
// equipped to show it: a customer whose link had been consumed by a mail
// scanner saw a signup form and concluded they had no account.
//
// This sits in the root layout rather than on the homepage because the
// fallback destination is Supabase configuration, not something this codebase
// controls. Wherever a stray auth fragment lands, it gets carried to the
// sign-in form with its reason intact.

export default function AuthFragmentGuard() {
  useEffect(() => {
    const hash = window.location.hash
    if (!hash || !hash.includes('error')) return

    const params = new URLSearchParams(hash.replace(/^#/, ''))
    const code = params.get('error_code') ?? params.get('error')
    if (!code) return

    // /auth/callback reads the fragment itself, and the login page is already
    // the destination — stepping in there would fight them.
    const path = window.location.pathname
    if (path.startsWith('/auth/callback') || path.startsWith('/dashboard/login')) return

    // Strip it before leaving: an auth fragment should not sit in history, and
    // a back button that replays it is its own confusion.
    window.history.replaceState(null, '', path + window.location.search)
    window.location.replace(`/dashboard/login?error=${encodeURIComponent(code)}`)
  }, [])

  return null
}
