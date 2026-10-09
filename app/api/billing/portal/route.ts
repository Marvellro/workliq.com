import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getCustomerSession } from '@/lib/session'
import { appUrl } from '@/lib/config'
import { findManageableSubscription } from '@/lib/billing'
import { recordAudit, clientIp, userAgent } from '@/lib/audit'

// Stripe's Billing Portal: where a customer changes payment method, sees
// invoices, or cancels.
//
// Until this existed there was no way to cancel a subscription at all. The
// Terms said "through your account settings" and Support said "Settings →
// Billing"; neither existed, so the only route out was emailing us. Beyond the
// broken promise, a cancellation that is hard to find does not become a
// retained customer — it becomes a chargeback, which costs more than the
// subscription and is harder to argue with.
//
// Stripe hosts the portal, deliberately: cancellation, proration and invoice
// history are exactly the flows worth not reimplementing, and it keeps card
// details somewhere we never touch.

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) {
    console.error('[billing/portal] STRIPE_SECRET_KEY is not set')
    return NextResponse.json({ error: 'Billing is not configured' }, { status: 500 })
  }

  // The same lookup the Settings page uses. Previously each had its own query
  // and they disagreed: the page reported no manageable subscription for an
  // account this route would have opened the portal for.
  const subscription = await findManageableSubscription(session.customerId)
  const stripeCustomerId = subscription?.stripe_customer_id

  if (!stripeCustomerId) {
    // Free accounts, and comps granted by hand, have no Stripe customer. A
    // normal state rather than a fault — the page hides the button, and this is
    // the matching answer for anyone calling the endpoint directly.
    return NextResponse.json(
      { error: 'This account has no Stripe subscription to manage.' },
      { status: 404 }
    )
  }

  const stripe = new Stripe(secret, { apiVersion: '2026-05-27.dahlia' })

  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: appUrl('/dashboard/settings'),
    })

    await recordAudit({
      action: 'billing.portal_opened',
      customerId: session.customerId,
      actor: session.email,
      // The portal URL is a bearer link to the customer's billing record, so it
      // is deliberately not recorded.
      metadata: { stripe_customer_id: stripeCustomerId },
      ip: clientIp(req),
      userAgent: userAgent(req),
    })

    return NextResponse.json({ url: portal.url })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[billing/portal] session create failed:', message)

    // Stripe refuses until a portal configuration has been saved once in the
    // dashboard. That is a setup step rather than a bug, and it produces a
    // message a customer cannot act on — so it is named here instead.
    if (message.toLowerCase().includes('configuration')) {
      return NextResponse.json(
        { error: 'Billing management is not yet enabled. Please contact support.' },
        { status: 503 }
      )
    }

    return NextResponse.json({ error: 'Could not open billing management' }, { status: 502 })
  }
}
