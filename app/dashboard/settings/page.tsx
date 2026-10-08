import { redirect } from 'next/navigation'
import { getCustomerSession } from '@/lib/session'
import { getSupabaseAdmin } from '@/lib/config'
import { getEntitlements } from '@/lib/plans'
import SettingsClient from './SettingsClient'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const session = await getCustomerSession()
  if (!session) redirect('/dashboard/login')

  const supabase = getSupabaseAdmin()

  const [entitlements, subscription, workflowCount, spend] = await Promise.all([
    getEntitlements(session.customerId),
    // customer_id only — the link is made at every sign-in by
    // claim_subscription_for_customer, and `eq` binds its value where
    // PostgREST's `or()` would take a raw filter string.
    supabase
      .from('subscriptions')
      .select('plan, status, billing_period, current_period_end, cancel_at_period_end, stripe_customer_id')
      .eq('customer_id', session.customerId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('workflows')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', session.customerId)
      .eq('enabled', true),
    supabase.rpc('ai_spend_this_month', { p_customer_id: session.customerId }),
  ])

  const spendRow = Array.isArray(spend.data) ? spend.data[0] : spend.data
  const sub = subscription.data

  return (
    <SettingsClient
      email={session.email}
      plan={{
        id: entitlements.plan,
        label: entitlements.label,
        maxWorkflows: entitlements.maxWorkflows,
        aiBudgetUsd: entitlements.aiMonthlyBudgetUsd,
        workflowsUsed: workflowCount.count ?? 0,
        aiSpentUsd: spendRow ? Number(spendRow.spent_usd ?? 0) : 0,
      }}
      subscription={
        sub
          ? {
              status: sub.status,
              billingPeriod: sub.billing_period,
              currentPeriodEnd: sub.current_period_end,
              cancelAtPeriodEnd: sub.cancel_at_period_end,
              // The id itself never reaches the browser — only whether one
              // exists, which is what decides if the button is shown.
              manageable: Boolean(sub.stripe_customer_id),
            }
          : null
      }
    />
  )
}
