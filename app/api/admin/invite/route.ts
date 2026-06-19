import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  try {
    const { email, name } = await req.json()
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

    const supabaseAdmin = getSupabaseAdmin()
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard`,
      data: { full_name: name },
    })

    if (error) throw error

    await supabaseAdmin
      .from('waitlist')
      .update({ status: 'invited', invited_at: new Date().toISOString() })
      .eq('email', email)

    return NextResponse.json({ success: true, userId: data.user?.id })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
