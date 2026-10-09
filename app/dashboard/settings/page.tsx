import { redirect } from 'next/navigation'
import { getCustomerSession } from '@/lib/session'
import { getSupabaseAdmin } from '@/lib/config'
import { getEntitlements } from '@/lib/plans'
import { findManageableSubscription } from '@/lib/billing'
import SettingsClient from './SettingsClient'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const session = await getCustomerSession()
  if (!session) redirect('/dashboard/login')

  const supabase = getSupabaseAdmin()

  const [entitlements, subscription, workflowCount, spend] = await Promise.all([
    getEntitlements(session.customerId),
    // Shared with the portal route. Asking this question twice is what put an
    // account that was paying $61 a month in front of "this plan was granted
    // directly, there is nothing to manage here".
    findManageableSubscription(session.customerId),
    supabase
      .from('workflows')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', session.customerId)
      .eq('enabled', true),
    supabase.rpc('ai_spend_this_month', { p_customer_id: session.customerId }),
  ])

  const spendRow = Array.isArray(spend.data) ? spend.data[0] : spend.data
  const sub = subscription

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
              // The id itself never reaches the browser. Reaching this branch
              // at all means a Stripe-backed subscription was found, which is
              // what the portal route will also find.
              manageable: true,
            }
          : null
      }
    />
  )
}
