import { getSupabaseAdmin } from './config'
import { getEntitlements, syncAiBudgetToPlan } from './plans'
import { recordAudit } from './audit'

// Everything that has to happen when a customer signs in, regardless of how.
//
// There are two ways in — a six-digit code, and an emailed link — and they were
// doing entirely different things. The code path upserted the customer row,
// claimed any subscription bought before the account existed, synced the AI
// budget, wrote an audit entry and set the session cookies. The link path set a
// client-side Supabase session and redirected to the admin waitlist page.
//
// So an account created by following a link had no customer row, no claimed
// subscription, no audit trail and no server session: signed in as far as the
// browser was concerned, and not signed in at all as far as the application
// was concerned. Someone who paid and then signed up by link would have sat on
// the free plan with no way to tell why.
//
// One function now, used by both.

export type EstablishedSession = {
  customerId: string
  email: string
}

/**
 * Records a successful sign-in and brings the account up to date.
 *
 * Does not touch cookies — the caller owns the response and sets them, because
 * the two entry points shape their responses differently.
 *
 * Nothing in here blocks the sign-in. A customer who has authenticated should
 * get in even if the bookkeeping around it fails; the alternative is locking
 * someone out of an account they just proved they own.
 */
export async function establishCustomerSession(args: {
  userId: string
  email: string
  ip?: string | null
  userAgent?: string | null
}): Promise<EstablishedSession> {
  const { userId, email, ip, userAgent } = args
  const normalizedEmail = email.trim().toLowerCase()
  const supabase = getSupabaseAdmin()

  // Service role so it writes regardless of RLS. onConflict makes re-logins
  // idempotent.
  const { error: customerError } = await supabase
    .from('customers')
    .upsert({ id: userId, email }, { onConflict: 'id' })

  if (customerError) {
    console.error('[session] failed to upsert customer row:', customerError.message)
  }

  // Link any subscription bought under this email to the account.
  //
  // Checkout happens before sign-up, so the very first billing webhook arrives
  // with no customer row to attach to. This is where the two finally meet —
  // without it, someone pays and then sits on the free plan, which is the worst
  // bug a billing system can have.
  const { error: claimError } = await supabase.rpc('claim_subscription_for_customer', {
    p_customer_id: userId,
    p_email: normalizedEmail,
  })

  if (claimError) {
    console.error('[session] failed to claim subscription:', claimError.message)
  } else {
    // Bring the AI budget in line with whatever they are actually paying for.
    const entitlements = await getEntitlements(userId)
    await syncAiBudgetToPlan(userId, entitlements.plan)
  }

  await recordAudit({
    action: 'customer.login',
    customerId: userId,
    actor: email,
    ip,
    userAgent,
  })

  return { customerId: userId, email }
}
