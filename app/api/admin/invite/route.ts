import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin, appUrl } from '@/lib/config'
import { requireAdmin, authErrorResponse } from '@/lib/admin'
import { recordAudit, clientIp, userAgent } from '@/lib/audit'

// Invites a waitlist entry into the product.
//
// SECURITY: this route previously had no authentication of any kind. It called
// `auth.admin.inviteUserByEmail` with the service-role key for any caller who
// knew the URL, so anyone on the internet could create accounts in this
// Supabase project. proxy.ts guarded `/admin/:path*` but its matchers are
// anchored to the start of the path and never covered `/api/admin/*`.
//
// requireAdmin() now verifies the session JWT and checks the `admins` table on
// every request, independent of proxy.ts.

export async function POST(req: NextRequest) {
  let admin
  try {
    admin = await requireAdmin(req)
  } catch (err) {
    const response = authErrorResponse(err)
    if (response) return response
    throw err
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body.email !== 'string' || !body.email.trim()) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 })
  }

  const email = body.email.trim().toLowerCase()
  const name = typeof body.name === 'string' ? body.name : undefined

  const supabaseAdmin = getSupabaseAdmin()

  // Only invite addresses that actually asked to be invited. Without this an
  // admin account (or a session stolen from one) could send Workliq-branded
  // invitations to arbitrary addresses, which is both a spam vector and a
  // convincing phishing primitive.
  const { data: entry, error: lookupError } = await supabaseAdmin
    .from('waitlist')
    .select('email, name, status')
    .eq('email', email)
    .maybeSingle()

  if (lookupError) {
    console.error('[admin/invite] waitlist lookup failed:', lookupError.message)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }
  if (!entry) {
    return NextResponse.json(
      { error: 'That email is not on the waitlist' },
      { status: 404 }
    )
  }

  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    redirectTo: appUrl('/dashboard'),
    data: { full_name: name ?? entry.name },
  })

  if (error) {
    await recordAudit({
      action: 'admin.invite_sent',
      actor: admin.email,
      metadata: { target: email, ok: false, reason: error.message },
      ip: clientIp(req),
      userAgent: userAgent(req),
    })
    // Surface Supabase's message to the admin — this is an authenticated
    // operator view, and "user already registered" is genuinely useful there.
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  const { error: updateError } = await supabaseAdmin
    .from('waitlist')
    .update({ status: 'invited', invited_at: new Date().toISOString() })
    .eq('email', email)

  if (updateError) {
    // The invite already went out; failing the request would invite them twice
    // on retry. Log it and let the admin see success.
    console.error('[admin/invite] status update failed:', updateError.message)
  }

  await recordAudit({
    action: 'admin.invite_sent',
    actor: admin.email,
    metadata: { target: email, ok: true },
    ip: clientIp(req),
    userAgent: userAgent(req),
  })

  return NextResponse.json({ success: true, userId: data.user?.id })
}
