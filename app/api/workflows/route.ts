import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCustomerSession } from '@/lib/session'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const TRIGGER_TYPES = ['deal_stage_changed', 'deal_created', 'deal_stale']
const ACTION_TYPES = ['slack_message', 'notion_row', 'webhook']
const CONDITION_OPERATORS = ['equals', 'not_equals', 'contains']
// Must match the properties workflow-engine.ts's getDealPropertyValue()
// actually knows how to read. An unrecognized property always resolves to
// null, which makes 'not_equals' silently match every deal (fail-open) —
// validating here at write time keeps that failure mode out of reach.
const CONDITION_PROPERTIES = ['dealstage', 'dealname', 'hubspot_owner_id']

export async function GET() {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('customer_id', session.customerId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Failed to load workflows' }, { status: 500 })
  return NextResponse.json({ workflows: data })
}

export async function POST(req: Request) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const {
    name,
    trigger_type,
    trigger_config,
    condition_property,
    condition_operator,
    condition_value,
    action_type,
    action_config,
  } = body

  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!TRIGGER_TYPES.includes(trigger_type)) {
    return NextResponse.json({ error: 'Invalid trigger_type' }, { status: 400 })
  }
  if (!ACTION_TYPES.includes(action_type)) {
    return NextResponse.json({ error: 'Invalid action_type' }, { status: 400 })
  }
  if (condition_operator && !CONDITION_OPERATORS.includes(condition_operator)) {
    return NextResponse.json({ error: 'Invalid condition_operator' }, { status: 400 })
  }
  if (condition_property && !CONDITION_PROPERTIES.includes(condition_property)) {
    return NextResponse.json({ error: 'Invalid condition_property' }, { status: 400 })
  }
  if (trigger_type === 'deal_stale') {
    const threshold = trigger_config?.threshold_days
    if (typeof threshold !== 'number' || threshold <= 0) {
      return NextResponse.json({ error: 'deal_stale requires trigger_config.threshold_days' }, { status: 400 })
    }
  }
  if (action_type === 'webhook') {
    const url = action_config?.url
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      return NextResponse.json({ error: 'webhook requires a valid https action_config.url' }, { status: 400 })
    }
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('workflows')
    .insert({
      customer_id: session.customerId,
      name: name.trim(),
      trigger_type,
      trigger_config: trigger_config ?? {},
      condition_property: condition_property || null,
      condition_operator: condition_operator || null,
      condition_value: condition_value || null,
      action_type,
      action_config: action_config ?? {},
      enabled: true,
    })
    .select()
    .single()

  if (error) {
    console.error('[api/workflows] insert failed:', error)
    return NextResponse.json({ error: 'Failed to create workflow' }, { status: 500 })
  }

  return NextResponse.json({ workflow: data }, { status: 201 })
}
