import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getCustomerSession } from '@/lib/session'
import {
  getSupabaseAdmin,
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from '@/lib/config'
import { recordAudit, clientIp, userAgent } from '@/lib/audit'

// Account deletion.
//
// The privacy policy commits to deleting personal data within 30 days. Until
// this existed that was a promise only a human with SQL access could keep —
// which is a commitment written ahead of the product, and the reason this is
// here.
//
// ── What deletion actually removes ──────────────────────────────────────────
// customers.id references auth.users with ON DELETE CASCADE, and every
// customer-owned table cascades from customers. So removing the auth user
// removes the whole tree in one statement the database enforces: connections
// and their encrypted tokens, workflows, run history including any AI-generated
// text, queued and dead jobs, stored HubSpot events, deal snapshots and alerts,
// and AI usage records.
//
// Two things survive, both deliberately, and both because customer_id is
// ON DELETE SET NULL rather than CASCADE:
//
//   subscriptions — the billing record. The policy keeps these for 7 years to
//                   meet financial reporting obligations, and says so.
//   audit_log     — unlinked from the customer, retaining the final entry
//                   written below. A deletion that erases its own record is not
//                   auditable.

export const dynamic = 'force-dynamic'

const CONFIRMATION = 'DELETE'

export async function POST(req: Request) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (body?.confirm !== CONFIRMATION) {
    return NextResponse.json(
      { error: `Type ${CONFIRMATION} to confirm.` },
      { status: 400 }
    )
  }

  const supabase = getSupabaseAdmin()

  // ── Stop the billing before removing the account ──────────────────────────
  // Order matters, and only one order is safe. Cancelling first and failing to
  // delete leaves a cancelled subscription on a live account, which is
  // recoverable and visible. Deleting first and failing to cancel leaves
  // somebody being charged for an account that no longer exists, with no way
  // for them to reach it.
  const { data: subs, error: subError } = await supabase
    .from('subscriptions')
    .select('stripe_subscription_id, status')
    .eq('customer_id', session.customerId)
    .in('status', ['active', 'trialing'])

  if (subError) {
    console.error('[account/delete] subscription lookup failed:', subError.message)
    return NextResponse.json({ error: 'Could not check billing status' }, { status: 500 })
  }

  const live = (subs ?? []).filter(
    (s) => s.stripe_subscription_id && !s.stripe_subscription_id.startsWith('comp_')
  )

  if (live.length > 0) {
    const secret = process.env.STRIPE_SECRET_KEY
    if (!secret) {
      console.error('[account/delete] STRIPE_SECRET_KEY is not set; refusing to delete')
      return NextResponse.json(
        { error: 'Billing cannot be reached, so the account was not deleted. Please contact support.' },
        { status: 503 }
      )
    }

    const stripe = new Stripe(secret, { apiVersion: '2026-05-27.dahlia' })

    for (const sub of live) {
      try {
        await stripe.subscriptions.cancel(sub.stripe_subscription_id as string)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        // `resource_missing` means Stripe has no such subscription — already
        // gone, so there is nothing left to stop and deletion may continue.
        if (!message.includes('resource_missing')) {
          console.error('[account/delete] cancel failed, aborting deletion:', message)
          return NextResponse.json(
            { error: 'Your subscription could not be cancelled, so nothing was deleted. Please try again or contact support.' },
            { status: 502 }
          )
        }
      }
    }
  }

  // Written before the delete, while there is still a customer to attribute it
  // to. customer_id is nulled by the cascade; the actor and the reason survive.
  await recordAudit({
    action: 'account.deletion_requested',
    customerId: session.customerId,
    actor: session.email,
    metadata: { subscriptions_cancelled: live.length },
    ip: clientIp(req),
    userAgent: userAgent(req),
  })

  // One statement. Everything customer-owned cascades from here.
  const { error: deleteError } = await supabase.auth.admin.deleteUser(session.customerId)

  if (deleteError) {
    console.error('[account/delete] auth user delete failed:', deleteError.message)
    return NextResponse.json(
      { error: 'The account could not be deleted. Your subscription has been cancelled — please contact support.' },
      { status: 500 }
    )
  }

  const response = NextResponse.json({ ok: true })
  for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]) {
    response.cookies.set(name, '', { maxAge: 0, path: '/' })
  }
  return response
}
