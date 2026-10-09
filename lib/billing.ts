import { getSupabaseAdmin } from './config'

// Which subscription an account's billing actually refers to.
//
// This exists because two places answered that question differently and the
// answers disagreed, which is worse than either being wrong on its own.
//
// The Settings page took the most recently updated subscription and asked
// whether it had a Stripe customer. The portal route filtered for a Stripe
// customer and took the most recently updated of those. For an account holding
// a comp alongside a real purchase, the page found the comp and reported
// "nothing to manage here", while the route would have found the purchase and
// opened the portal. The customer was told they had no subscription to manage
// while paying for one.
//
// What made the two diverge is the same tie fixed in 018:
// claim_subscription_for_customer stamps every row it links with the same
// updated_at on every sign-in, so `order by updated_at desc limit 1` resolves a
// tie and returns whichever row Postgres reaches first.

export type ManageableSubscription = {
  plan: string
  status: string
  billing_period: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  stripe_customer_id: string
}

/**
 * The Stripe-backed subscription to show and to manage, or null.
 *
 * Null is a normal answer, not a failure: free accounts have no subscription,
 * and a comp granted by hand has no Stripe customer behind it. Those are
 * different states and the caller distinguishes them, but neither is
 * manageable through Stripe's portal.
 *
 * Rows without a Stripe customer are excluded rather than ranked below, because
 * a comp is not a thing the portal can open at all. Among the rest the ordering
 * is deterministic — longest-running first, then most recently touched, then id
 * — so the page and the portal always land on the same subscription. Agreeing
 * matters more here than which one wins: a button that appears and then fails,
 * or fails to appear for an account that has one, are both worse than either
 * choice of row.
 */
export async function findManageableSubscription(
  customerId: string
): Promise<ManageableSubscription | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('subscriptions')
    .select('plan, status, billing_period, current_period_end, cancel_at_period_end, stripe_customer_id')
    .eq('customer_id', customerId)
    .not('stripe_customer_id', 'is', null)
    .order('current_period_end', { ascending: false, nullsFirst: true })
    .order('updated_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[billing] subscription lookup failed:', error.message)
    return null
  }

  return (data as ManageableSubscription | null) ?? null
}
