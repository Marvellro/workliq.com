'use client'

import { useState } from 'react'

type TriggerType = 'deal_stage_changed' | 'deal_created' | 'deal_stale'
type ActionType = 'slack_message' | 'notion_row' | 'webhook'
type ConditionOperator = 'equals' | 'not_equals' | 'contains'

type Workflow = {
  id: string
  name: string
  trigger_type: TriggerType
  trigger_config: { to_stage?: string; threshold_days?: number }
  condition_property: string | null
  condition_operator: ConditionOperator | null
  condition_value: string | null
  action_type: ActionType
  action_config: { message_template?: string; url?: string }
  enabled: boolean
}

type Props = {
  initialWorkflows: Workflow[]
  slackConnected: boolean
  notionConnected: boolean
}

const TRIGGER_LABELS: Record<TriggerType, string> = {
  deal_created: 'A deal is created',
  deal_stage_changed: 'A deal changes stage',
  deal_stale: 'A deal goes stale',
}

const ACTION_LABELS: Record<ActionType, string> = {
  slack_message: 'Send a Slack message',
  notion_row: 'Add a Notion row',
  webhook: 'Call a webhook',
}

function summarize(w: Workflow): string {
  let trigger = TRIGGER_LABELS[w.trigger_type]
  if (w.trigger_type === 'deal_stage_changed' && w.trigger_config.to_stage) {
    trigger = `A deal moves to "${w.trigger_config.to_stage}"`
  }
  if (w.trigger_type === 'deal_stale' && w.trigger_config.threshold_days) {
    trigger = `A deal has no activity for ${w.trigger_config.threshold_days}+ days`
  }
  let condition = ''
  if (w.condition_property && w.condition_operator && w.condition_value) {
    const opLabel = w.condition_operator === 'not_equals' ? 'is not' : w.condition_operator === 'contains' ? 'contains' : 'is'
    condition = `, if ${w.condition_property} ${opLabel} "${w.condition_value}"`
  }
  return `When ${trigger}${condition} → ${ACTION_LABELS[w.action_type]}`
}

export default function WorkflowsClient({ initialWorkflows, slackConnected, notionConnected }: Props) {
  const [workflows, setWorkflows] = useState<Workflow[]>(initialWorkflows)
  const [showForm, setShowForm] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function handleToggle(id: string, enabled: boolean) {
    setBusyId(id)
    const res = await fetch(`/api/workflows/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    if (res.ok) {
      const { workflow } = await res.json()
      setWorkflows((prev) => prev.map((w) => (w.id === id ? workflow : w)))
    }
    setBusyId(null)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this workflow? This cannot be undone.')) return
    setBusyId(id)
    const res = await fetch(`/api/workflows/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setWorkflows((prev) => prev.filter((w) => w.id !== id))
    }
    setBusyId(null)
  }

  function handleCreated(workflow: Workflow) {
    setWorkflows((prev) => [workflow, ...prev])
    setShowForm(false)
  }

  return (
    <main style={{ minHeight: '100vh', background: '#F9FAFB', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <nav style={{ background: '#fff', borderBottom: '0.5px solid #E5E7EB', padding: '0 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, background: '#1A56DB', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: '#fff' }}>W</div>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#0D0F1A', letterSpacing: '-0.025em' }}>Workliq</span>
        </div>
        <a href="/dashboard" style={{ fontSize: 13, color: '#6B7280', textDecoration: 'none', border: '1px solid #E5E7EB', borderRadius: 6, padding: '0.35rem 0.75rem' }}>
          ← Connections
        </a>
      </nav>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '2.5rem 1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, color: '#0D0F1A', marginBottom: '0.4rem', letterSpacing: '-0.02em' }}>
              Workflows
            </h1>
            <p style={{ fontSize: 14, color: '#6B7280' }}>
              Automate what happens when deals change in HubSpot.
            </p>
          </div>
          <button
            onClick={() => setShowForm((v) => !v)}
            style={{ fontSize: 14, fontWeight: 600, color: '#fff', background: '#1A56DB', borderRadius: 8, padding: '0.55rem 1.1rem', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            {showForm ? 'Cancel' : '+ New workflow'}
          </button>
        </div>

        {showForm && (
          <NewWorkflowForm
            slackConnected={slackConnected}
            notionConnected={notionConnected}
            onCreated={handleCreated}
          />
        )}

        {workflows.length === 0 && !showForm && (
          <div style={{ background: '#fff', border: '0.5px dashed #D1D5DB', borderRadius: 12, padding: '2.5rem 1.5rem', textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: '#6B7280', marginBottom: '1rem' }}>No workflows yet.</p>
            <button
              onClick={() => setShowForm(true)}
              style={{ fontSize: 14, fontWeight: 600, color: '#1A56DB', background: 'none', border: '1px solid #1A56DB', borderRadius: 8, padding: '0.5rem 1rem', cursor: 'pointer' }}
            >
              Create your first workflow
            </button>
          </div>
        )}

        {workflows.map((w) => (
          <div
            key={w.id}
            style={{ background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 12, padding: '1.1rem 1.5rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', opacity: busyId === w.id ? 0.6 : 1 }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#0D0F1A', marginBottom: 3 }}>{w.name}</div>
              <div style={{ fontSize: 13, color: '#6B7280' }}>{summarize(w)}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
              <button
                onClick={() => handleToggle(w.id, !w.enabled)}
                disabled={busyId === w.id}
                style={{
                  fontSize: 12, fontWeight: 600, borderRadius: 20, padding: '0.25rem 0.65rem', border: '1px solid',
                  cursor: busyId === w.id ? 'default' : 'pointer',
                  color: w.enabled ? '#166534' : '#6B7280',
                  background: w.enabled ? '#F0FDF4' : '#F9FAFB',
                  borderColor: w.enabled ? '#BBF7D0' : '#E5E7EB',
                }}
              >
                {w.enabled ? 'Enabled' : 'Paused'}
              </button>
              <button
                onClick={() => handleDelete(w.id)}
                disabled={busyId === w.id}
                style={{ fontSize: 13, color: '#991B1B', background: 'none', border: '1px solid #FECACA', borderRadius: 6, padding: '0.35rem 0.65rem', cursor: busyId === w.id ? 'default' : 'pointer' }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}

// ── New workflow form ───────────────────────────────────────────────────────

function NewWorkflowForm({
  slackConnected,
  notionConnected,
  onCreated,
}: {
  slackConnected: boolean
  notionConnected: boolean
  onCreated: (w: Workflow) => void
}) {
  const [name, setName] = useState('')
  const [triggerType, setTriggerType] = useState<TriggerType>('deal_created')
  const [toStage, setToStage] = useState('')
  const [thresholdDays, setThresholdDays] = useState('7')
  const [conditionProperty, setConditionProperty] = useState('')
  const [conditionOperator, setConditionOperator] = useState<ConditionOperator>('equals')
  const [conditionValue, setConditionValue] = useState('')
  const [actionType, setActionType] = useState<ActionType>('slack_message')
  const [messageTemplate, setMessageTemplate] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) return setError('Give the workflow a name.')
    if (triggerType === 'deal_stale' && (!thresholdDays || Number(thresholdDays) <= 0)) {
      return setError('Enter a number of days for the staleness threshold.')
    }
    if (actionType === 'webhook' && !webhookUrl.trim().startsWith('https://')) {
      return setError('Webhook URL must start with https://')
    }
    if (actionType === 'slack_message' && !slackConnected) {
      return setError('Connect Slack first — see Connections.')
    }
    if (actionType === 'notion_row' && !notionConnected) {
      return setError('Connect Notion first — see Connections.')
    }

    setSaving(true)
    const trigger_config: Record<string, unknown> = {}
    if (triggerType === 'deal_stage_changed' && toStage.trim()) trigger_config.to_stage = toStage.trim()
    if (triggerType === 'deal_stale') trigger_config.threshold_days = Number(thresholdDays)

    const action_config: Record<string, unknown> = {}
    if (actionType === 'slack_message' && messageTemplate.trim()) action_config.message_template = messageTemplate.trim()
    if (actionType === 'webhook') action_config.url = webhookUrl.trim()

    const res = await fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        trigger_type: triggerType,
        trigger_config,
        condition_property: conditionProperty || null,
        condition_operator: conditionProperty ? conditionOperator : null,
        condition_value: conditionProperty ? conditionValue.trim() || null : null,
        action_type: actionType,
        action_config,
      }),
    })

    setSaving(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return setError(body.error ?? 'Failed to create workflow.')
    }
    const { workflow } = await res.json()
    onCreated(workflow)
  }

  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: '0.375rem' }
  const inputStyle: React.CSSProperties = { width: '100%', fontSize: 14, color: '#0D0F1A', border: '1px solid #E5E7EB', borderRadius: 8, padding: '0.55rem 0.75rem', boxSizing: 'border-box' }
  const fieldWrap: React.CSSProperties = { marginBottom: '1.1rem' }

  return (
    <form onSubmit={handleSubmit} style={{ background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 12, padding: '1.5rem', marginBottom: '1.5rem' }}>
      <div style={fieldWrap}>
        <label style={labelStyle}>Name</label>
        <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alert sales on stalled deals" />
      </div>

      <div style={fieldWrap}>
        <label style={labelStyle}>When…</label>
        <select style={inputStyle} value={triggerType} onChange={(e) => setTriggerType(e.target.value as TriggerType)}>
          <option value="deal_created">A deal is created</option>
          <option value="deal_stage_changed">A deal changes stage</option>
          <option value="deal_stale">A deal goes stale</option>
        </select>
      </div>

      {triggerType === 'deal_stage_changed' && (
        <div style={fieldWrap}>
          <label style={labelStyle}>Only when moved to this stage (optional)</label>
          <input style={inputStyle} value={toStage} onChange={(e) => setToStage(e.target.value)} placeholder="e.g. closedwon — leave blank for any stage change" />
        </div>
      )}

      {triggerType === 'deal_stale' && (
        <div style={fieldWrap}>
          <label style={labelStyle}>Days without activity</label>
          <input style={{ ...inputStyle, width: 100 }} type="number" min={1} value={thresholdDays} onChange={(e) => setThresholdDays(e.target.value)} />
        </div>
      )}

      <div style={fieldWrap}>
        <label style={labelStyle}>Only if… (optional condition)</label>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <select style={inputStyle} value={conditionProperty} onChange={(e) => setConditionProperty(e.target.value)}>
            <option value="">No condition</option>
            <option value="dealstage">Deal stage</option>
            <option value="dealname">Deal name</option>
          </select>
          {conditionProperty && (
            <>
              <select style={{ ...inputStyle, width: 140 }} value={conditionOperator} onChange={(e) => setConditionOperator(e.target.value as ConditionOperator)}>
                <option value="equals">is</option>
                <option value="not_equals">is not</option>
                <option value="contains">contains</option>
              </select>
              <input style={inputStyle} value={conditionValue} onChange={(e) => setConditionValue(e.target.value)} placeholder="value" />
            </>
          )}
        </div>
      </div>

      <div style={fieldWrap}>
        <label style={labelStyle}>Then…</label>
        <select style={inputStyle} value={actionType} onChange={(e) => setActionType(e.target.value as ActionType)}>
          <option value="slack_message">Send a Slack message {!slackConnected && '(connect Slack first)'}</option>
          <option value="notion_row">Add a Notion row {!notionConnected && '(connect Notion first)'}</option>
          <option value="webhook">Call a webhook</option>
        </select>
      </div>

      {actionType === 'slack_message' && (
        <div style={fieldWrap}>
          <label style={labelStyle}>Message (optional — leave blank for a default message)</label>
          <textarea
            style={{ ...inputStyle, minHeight: 70, fontFamily: 'inherit', resize: 'vertical' }}
            value={messageTemplate}
            onChange={(e) => setMessageTemplate(e.target.value)}
            placeholder="{{deal_name}} moved to {{stage}} — owned by {{owner}}. {{link}}"
          />
          <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: '0.375rem' }}>
            Available placeholders: {'{{deal_name}}'}, {'{{stage}}'}, {'{{owner}}'}, {'{{link}}'}
          </p>
        </div>
      )}

      {actionType === 'webhook' && (
        <div style={fieldWrap}>
          <label style={labelStyle}>Webhook URL</label>
          <input style={inputStyle} value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://your-endpoint.example.com/hook" />
        </div>
      )}

      {error && (
        <div style={{ fontSize: 13, color: '#991B1B', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '0.6rem 0.85rem', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={saving}
        style={{ fontSize: 14, fontWeight: 600, color: '#fff', background: '#1A56DB', borderRadius: 8, padding: '0.6rem 1.25rem', border: 'none', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}
      >
        {saving ? 'Saving…' : 'Create workflow'}
      </button>
    </form>
  )
}
