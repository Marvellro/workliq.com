'use client'

import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function LoginPage() {
  const [email, setEmail]     = useState('')
  const [otp, setOtp]         = useState('')
  const [sent, setSent]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  async function handleSendCode() {
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })
    if (error) setError(error.message)
    else setSent(true)
    setLoading(false)
  }

  async function handleVerifyCode() {
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: 'email',
    })
    if (error) setError(error.message)
    else window.location.href = '/admin/waitlist'
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 w-full max-w-sm">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">Admin login</h1>
          <p className="text-sm text-gray-500 mt-1">
            {sent
              ? 'Enter the 6-digit code we sent to your email.'
              : 'Enter your admin email to receive a code.'}
          </p>
        </div>

        {!sent ? (
          <div className="space-y-4">
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSendCode()}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              onClick={handleSendCode}
              disabled={loading || !email}
              className="w-full py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50 transition"
            >
              {loading ? 'Sending…' : 'Send code'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <input
              type="text"
              inputMode="numeric"
              placeholder="123456"
              value={otp}
              onChange={e => setOtp(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleVerifyCode()}
              maxLength={6}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              onClick={handleVerifyCode}
              disabled={loading || otp.length < 6}
              className="w-full py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50 transition"
            >
              {loading ? 'Verifying…' : 'Verify & sign in'}
            </button>
            <button
              onClick={() => { setSent(false); setOtp(''); setError('') }}
              className="w-full text-xs text-gray-400 hover:text-gray-600"
            >
              Use a different email
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
