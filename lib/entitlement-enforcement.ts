import { getSupabaseAdmin } from './config'
import { getEntitlements } from './plans'
import { recordAudit } from './audit'

// Keeping what is running in step with what is paid for.
//
// Plan limits were checked when a workflow was created or switched on, and
// nowhere else — so they governed how many workflows an account could turn on
// and nothing about how many kept running. Cancelling a subscription left every
// workflow firing.

export type PauseDecision = {
  /** Kept running, oldest first. */
  keep: string[]
  /** Switched off, and why the customer will be told. */
  pause: string[]
}

type Candidate = { id: string; created_at: string }

/**
 * Decides which workflows survive a plan limit.
 *
 * The oldest are kept. Not because age is a good proxy for value, but because
 * the rule has to be stated in one sentence to a customer who just lost
 * something — "we kept the first N you built" is explainable, and it is stable:
 * running it twice on the same account chooses the same workflows, so a repeated
 * webhook cannot pause a different set the second time.
 *
 * Pure and exported so the rule is asserted directly rather than inferred from
 * whatever happened to a live account.
 */
export function decidePauses(enabled: readonly Candidate[], maxWorkflows: number): PauseDecision {
  const ordered = [...enabled].sort((a, b) => {
    const byAge = Date.parse(a.created_at) - Date.parse(b.created_at)
    // A deterministic final tiebreak: two workflows created in the same
    // millisecond must not resolve differently between runs.
    return byAge !== 0 ? byAge : a.id.localeCompare(b.id)
  })

  return {
    keep: ordered.slice(0, Math.max(0, maxWorkflows)).map((w) => w.id),
    pause: ordered.slice(Math.max(0, maxWorkflows)).map((w) => w.id),
  }
}

/**
 * Brings an account's running workflows within its current plan.
 *
 * Returns how many were paused. Safe to call often: an account already within
 * its limit does one indexed read and stops.
 *
 * Never throws. It runs from a Stripe webhook handler and from the daily cron,
 * and neither should fail because enforcement bookkeeping did.
 */
export async function pauseWorkflowsOverLimit(customerId: string): Promise<number> {
  try {
    const supabase = getSupabaseAdmin()
    const entitlements = await getEntitlements(customerId)

    const { data: enabled, error } = await supabase
      .from('workflows')
      .select('id, created_at')
      .eq('customer_id', customerId)
      .eq('enabled', true)

    if (error) {
      console.error('[entitlements] could not read workflows:', error.message)
      return 0
    }

    const { pause } = decidePauses(enabled ?? [], entitlements.maxWorkflows)
    if (pause.length === 0) return 0

    const { error: pauseError } = await supabase
      .from('workflows')
      .update({
        enabled: false,
        paused_by_plan: true,
        paused_at: new Date().toISOString(),
        // Null, so the digest picks it up. Reset here rather than left alone
        // because a workflow paused, re-enabled and paused again is a second
        // event the customer should hear about.
        paused_notified_at: null,
        updated_at: new Date().toISOString(),
      })
      .in('id', pause)

    if (pauseError) {
      console.error('[entitlements] could not pause workflows:', pauseError.message)
      return 0
    }

    await recordAudit({
      action: 'workflow.paused_by_plan',
      customerId,
      actor: 'system',
      metadata: {
        plan: entitlements.plan,
        max_workflows: entitlements.maxWorkflows,
        paused: pause.length,
      },
    })

    console.log(
      `[entitlements] paused ${pause.length} workflow(s) for ${customerId}: over the ${entitlements.plan} limit of ${entitlements.maxWorkflows}`
    )
    return pause.length
  } catch (err) {
    console.error('[entitlements] pauseWorkflowsOverLimit threw:', err)
    return 0
  }
}

/**
 * Runs the check for every account that has anything enabled.
 *
 * The webhook path covers a plan that changes. This covers the one that lapses
 * by the clock instead: a comp with an end date, or a
 * `customer.subscription.deleted` that never arrived — and the whole of 012 and
 * 013 exists because webhooks silently fail to arrive.
 *
 * Only accounts with at least one enabled workflow are considered, so an idle
 * database costs one indexed read.
 */
export async function enforceAllEntitlements(): Promise<{ accounts: number; paused: number }> {
  const result = { accounts: 0, paused: 0 }

  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('workflows')
      .select('customer_id')
      .eq('enabled', true)

    if (error) {
      console.error('[entitlements] could not list accounts:', error.message)
      return result
    }

    const customerIds = Array.from(new Set((data ?? []).map((row) => row.customer_id)))

    for (const customerId of customerIds) {
      result.accounts++
      result.paused += await pauseWorkflowsOverLimit(customerId)
    }
  } catch (err) {
    console.error('[entitlements] enforceAllEntitlements threw:', err)
  }

  return result
}
