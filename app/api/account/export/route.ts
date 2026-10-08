import { NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/session'
import { getSupabaseAdmin } from '@/lib/config'
import { recordAudit, clientIp, userAgent } from '@/lib/audit'

// Data export.
//
// The Terms say that on termination a customer has 30 days "during which you
// may export it", and the privacy policy offers portability. Neither was true:
// there was no export, so both were commitments nobody could meet.
//
// ── What is deliberately NOT in here ────────────────────────────────────────
// Credentials. The obvious ones are the HubSpot and Notion access tokens, but
// the one worth naming is the Slack webhook URL: it looks like a setting and it
// is a bearer credential — anyone holding it can post into that channel as
// Workliq, with no further authentication. An export is a file that ends up in
// inboxes and download folders, so it carries what a connection *is*, never
// what it is authenticated by.
//
// customers.webhook_secret is excluded for the same reason: it is the key the
// customer's own endpoint uses to verify our signatures.

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getSupabaseAdmin()
  const id = session.customerId

  const [customer, workflows, runs, subscriptions, aiUsage, alerts, snapshots, audit, hubspot, slack, notion] =
    await Promise.all([
      // Named columns rather than '*', so a column added later cannot quietly
      // start appearing in exports.
      supabase
        .from('customers')
        .select('id, email, plan, stale_threshold_days, ai_monthly_budget_usd, ai_budget_override_usd, created_at')
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('workflows')
        .select('id, name, trigger_type, trigger_config, condition_property, condition_operator, condition_value, steps, enabled, created_at, updated_at')
        .eq('customer_id', id),
      supabase
        .from('workflow_runs')
        .select('workflow_id, deal_id, trigger_fingerprint, step_index, status, error_message, output, fired_at')
        .eq('customer_id', id)
        .order('fired_at', { ascending: false })
        .limit(5000),
      supabase
        .from('subscriptions')
        .select('plan, billing_period, status, current_period_end, cancel_at_period_end, stripe_customer_id, stripe_subscription_id, created_at, updated_at')
        .eq('customer_id', id),
      supabase
        .from('ai_usage')
        .select('workflow_id, task, model, input_tokens, output_tokens, cost_usd, succeeded, created_at')
        .eq('customer_id', id)
        .limit(5000),
      supabase.from('deal_alerts').select('deal_id, threshold, slack_notified, notion_logged, created_at').eq('customer_id', id).limit(5000),
      supabase.from('deal_snapshots').select('deal_id, first_seen_at, updated_at').eq('customer_id', id).limit(5000),
      supabase
        .from('audit_log')
        .select('action, actor, metadata, ip, user_agent, created_at')
        .eq('customer_id', id)
        .order('created_at', { ascending: false })
        .limit(2000),
      // Connections: what each one IS, never what authenticates it.
      supabase.from('hubspot_connections').select('hub_id, status, last_error_at, last_success_at, created_at').eq('customer_id', id).maybeSingle(),
      supabase.from('slack_connections').select('team_name, channel_name, status, last_error_at, last_success_at, created_at').eq('customer_id', id).maybeSingle(),
      supabase.from('notion_connections').select('workspace_name, database_id, status, last_error_at, last_success_at, created_at').eq('customer_id', id).maybeSingle(),
    ])

  if (customer.error) {
    console.error('[account/export] failed:', customer.error.message)
    return NextResponse.json({ error: 'Could not build the export' }, { status: 500 })
  }

  const payload = {
    exported_at: new Date().toISOString(),
    note:
      'Credentials are deliberately omitted: OAuth tokens, the Slack webhook URL and your outbound webhook signing secret are not included, because this file is not a safe place for them.',
    account: customer.data,
    connections: {
      hubspot: hubspot.data ?? null,
      slack: slack.data ?? null,
      notion: notion.data ?? null,
    },
    subscriptions: subscriptions.data ?? [],
    workflows: workflows.data ?? [],
    workflow_runs: runs.data ?? [],
    ai_usage: aiUsage.data ?? [],
    deal_alerts: alerts.data ?? [],
    deal_snapshots: snapshots.data ?? [],
    audit_log: audit.data ?? [],
  }

  await recordAudit({
    action: 'account.exported',
    customerId: id,
    actor: session.email,
    metadata: {
      workflows: payload.workflows.length,
      runs: payload.workflow_runs.length,
    },
    ip: clientIp(req),
    userAgent: userAgent(req),
  })

  const date = new Date().toISOString().slice(0, 10)
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="workliq-export-${date}.json"`,
      // A file containing an account's entire history should not sit in a
      // shared cache.
      'Cache-Control': 'no-store',
    },
  })
}
