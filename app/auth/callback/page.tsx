'use client'

import { useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

export default function AuthCallbackPage() {
  useEffect(() => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        window.location.href = '/admin/waitlist'
      }
    })
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-500 text-sm">Signing you in…</p>
    </div>
  )
}
