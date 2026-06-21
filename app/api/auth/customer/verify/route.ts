import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Cookie lifetime: 7 days. Supabase JWTs expire sooner (default 1 hour) but
// the refresh_token is long-lived. The session helper re-hydrates via
// setSession on each request, which will auto-refresh the JWT if needed.
const SESSION_MAX_AGE = 60 * 60 * 24 * 7

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { email, otp } = body as { email?: unknown; otp?: unknown }

  if (typeof email !== 'string' || !email || typeof otp !== 'string' || !otp) {
    return NextResponse.json({ error: 'Missing email or code' }, { status: 400 })
  }

  const { data, error } = await getSupabase().auth.verifyOtp({
    email,
    token: otp,
    type: 'email',
  })

  if (error || !data.session || !data.user) {
    return NextResponse.json(
      { error: error?.message ?? 'Verification failed' },
      { status: 401 }
    )
  }

  // Ensure a customers row exists for this user. Uses service role so it can
  // write regardless of RLS. onConflict: 'id' makes re-logins idempotent.
  const { error: customerError } = await getSupabaseAdmin()
    .from('customers')
    .upsert(
      { id: data.user.id, email: data.user.email },
      { onConflict: 'id' }
    )

  if (customerError) {
    // Don't block login over this — the row may already exist. Log and continue.
    console.error('Failed to upsert customer row:', customerError)
  }

  const cookieOpts = {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_MAX_AGE,
  }

  const response = NextResponse.json({ success: true })
  response.cookies.set('sb-access-token', data.session.access_token, cookieOpts)
  response.cookies.set('sb-refresh-token', data.session.refresh_token, cookieOpts)
  return response
}
