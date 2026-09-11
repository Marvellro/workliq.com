import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/config'
import { requireAdmin, authErrorResponse } from '@/lib/admin'
import { recordAudit, clientIp, userAgent } from '@/lib/audit'

// Admin waitlist operations.
//
// These exist because the admin page previously talked to Supabase directly
// from the browser using the anon key. That could never have worked: the
// waitlist RLS policies gate on `EXISTS (SELECT 1 FROM admins WHERE email =
// auth.email())`, and the browser client had no Supabase session at all —
// sessions live in httpOnly cookies the client-side SDK cannot read. Listing
// returned empty and every write was rejected.
//
// Routing through the server fixes it properly: authorization is checked once,
// server-side, against a signed session, and the browser never needs database
// credentials.

const VALID_STATUSES = ['pending', 'invited', 'rejected'] as const
type WaitlistStatus = (typeof VALID_STATUSES)[number]

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req)
  } catch (err) {
    const response = authErrorResponse(err)
    if (response) return response
    throw err
  }

  const { data, error } = await getSupabaseAdmin()
    .from('waitlist')
    .select('id, name, email, role, status, created_at, invited_at')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[admin/waitlist] list failed:', error.message)
    return NextResponse.json({ error: 'Failed to load waitlist' }, { status: 500 })
  }

  return NextResponse.json({ entries: data })
}

export async function PATCH(req: NextRequest) {
  let admin
  try {
    admin = await requireAdmin(req)
  } catch (err) {
    const response = authErrorResponse(err)
    if (response) return response
    throw err
  }

  const body = await req.json().catch(() => null)
  const id = body?.id
  const status = body?.status

  if (typeof id !== 'string' || !VALID_STATUSES.includes(status as WaitlistStatus)) {
    return NextResponse.json(
      { error: `id and status (${VALID_STATUSES.join(' | ')}) are required` },
      { status: 400 }
    )
  }

  const update: Record<string, unknown> = { status }
  if (status === 'rejected') update.rejected_at = new Date().toISOString()

  const { data, error } = await getSupabaseAdmin()
    .from('waitlist')
    .update(update)
    .eq('id', id)
    .select('email')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Waitlist entry not found' }, { status: 404 })
  }

  await recordAudit({
    action: 'admin.waitlist_updated',
    actor: admin.email,
    metadata: { target: data.email, status },
    ip: clientIp(req),
    userAgent: userAgent(req),
  })

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  let admin
  try {
    admin = await requireAdmin(req)
  } catch (err) {
    const response = authErrorResponse(err)
    if (response) return response
    throw err
  }

  const id = new URL(req.url).searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  // Read the row first so the audit entry records who was removed — after the
  // delete there is nothing left to identify them by.
  const { data: existing } = await getSupabaseAdmin()
    .from('waitlist')
    .select('email')
    .eq('id', id)
    .maybeSingle()

  const { error, count } = await getSupabaseAdmin()
    .from('waitlist')
    .delete({ count: 'exact' })
    .eq('id', id)

  if (error) {
    console.error('[admin/waitlist] delete failed:', error.message)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
  if (!count) {
    return NextResponse.json({ error: 'Waitlist entry not found' }, { status: 404 })
  }

  await recordAudit({
    action: 'admin.waitlist_deleted',
    actor: admin.email,
    metadata: { target: existing?.email ?? id },
    ip: clientIp(req),
    userAgent: userAgent(req),
  })

  return NextResponse.json({ success: true })
}
