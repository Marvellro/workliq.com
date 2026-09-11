import { redirect } from 'next/navigation'
import { getCustomerSession } from '@/lib/session'
import { getSupabaseAdmin } from '@/lib/config'
import ActivityClient from './ActivityClient'

export default async function ActivityPage() {
  const session = await getCustomerSession()
  if (!session) redirect('/dashboard/login')

  const supabase = getSupabaseAdmin()

  // Rendered server-side so the page arrives populated rather than flashing an
  // empty state and filling in. The client polls from here on.
  const [runs, queue, spend] = await Promise.all([
    supabase
      .from('workflow_runs')
      .select('id, workflow_id, deal_id, trigger_fingerprint, status, error_message, fired_at, workflows(name, action_type)')
      .eq('customer_id', session.customerId)
      .order('fired_at', { ascending: false })
      .limit(50),
    supabase
      .from('jobs')
      .select('id, kind, status, attempts, max_attempts, last_error, run_after, created_at')
      .eq('customer_id', session.customerId)
      .in('status', ['pending', 'running', 'dead'])
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.rpc('ai_spend_this_month', { p_customer_id: session.customerId }),
  ])

  const spendRow = Array.isArray(spend.data) ? spend.data[0] : spend.data

  return (
    <ActivityClient
      initialRuns={(runs.data ?? []) as never}
      initialQueue={(queue.data ?? []) as never}
      initialSpend={
        spendRow
          ? {
              spentUsd: Number(spendRow.spent_usd ?? 0),
              budgetUsd: Number(spendRow.budget_usd ?? 0),
              remainingUsd: Number(spendRow.remaining_usd ?? 0),
            }
          : null
      }
    />
  )
}
