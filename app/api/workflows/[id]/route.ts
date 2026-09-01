import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCustomerSession } from '@/lib/session'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled (boolean) is required' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // Scope the update to this customer's own row — the service role key would
  // otherwise happily update any workflow regardless of owner.
  const { data, error } = await supabase
    .from('workflows')
    .update({ enabled: body.enabled, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('customer_id', session.customerId)
    .select()
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  return NextResponse.json({ workflow: data })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = getSupabaseAdmin()

  const { error, count } = await supabase
    .from('workflows')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('customer_id', session.customerId)

  if (error) return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  if (!count) return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
