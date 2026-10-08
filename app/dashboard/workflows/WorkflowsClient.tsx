'use client'

import { useState } from 'react'

type TriggerType = 'deal_stage_changed' | 'deal_created' | 'deal_stale'
type ActionType = 'slack_message' | 'notion_row' | 'webhook' | 'ai_step'
type AITask = 'summarize' | 'draft_followup' | 'score_lead' | 'next_action'
type ConditionOperator = 'equals' | 'not_equals' | 'contains'

type StepConfig = {
  message_template?: string
  url?: string
  ai_task?: AITask
  ai_instructions?: string
  deliver_to?: 'slack_message' | 'notion_row'
}

type Step = { action_type: ActionType; action_config: StepConfig }

const MAX_STEPS = 10

type Workflow = {
  id: string
  name: string
  trigger_type: TriggerType
  trigger_config: { to_stage?: string; threshold_days?: number }
  condition_property: string | null
  condition_operator: ConditionOperator | null
  condition_value: string | null
  steps: Step[]
  /** Legacy single action, superseded by steps. Still present on old rows. */
  action_type: ActionType | null
  action_config: StepConfig | null
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
  ai_step: 'Ask AI',
}

const AI_TASK_LABELS: Record<AITask, string> = {
  summarize: 'Summarise the deal',
  draft_followup: 'Draft a follow-up email',
  score_lead: 'Score how urgent it is',
  next_action: 'Recommend the next action',
}

/** Mirrors lib/workflow-steps.ts — old rows still carry the single action. */
function stepsOf(w: Workflow): Step[] {
  if (w.steps?.length) return w.steps
  if (w.action_type) return [{ action_type: w.action_type, action_config: w.action_config ?? {} }]
  return []
}

function describeStep(s: Step): string {
  if (s.action_type === 'ai_step' && s.action_config.ai_task) {
    const task = AI_TASK_LABELS[s.action_config.ai_task].toLowerCase()
    // deliver_to only appears on workflows built before steps existed, where
    // the AI step carried its own delivery.
    return s.action_config.deliver_to
      ? `AI: ${task}, posted to ${s.action_config.deliver_to === 'notion_row' ? 'Notion' : 'Slack'}`
      : `AI: ${task}`
  }
  return ACTION_LABELS[s.action_type]
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
  const action = stepsOf(w).map(describeStep).join(' → ')
  // TRIGGER_LABELS are written to stand alone ("A deal is created"), but here
  // they are interpolated mid-sentence after "When". Lowercasing the first
  // letter at the join keeps both readings correct without a second set of
  // strings to maintain — every label begins "A deal", so this is always safe.
  const midSentence = trigger.charAt(0).toLowerCase() + trigger.slice(1)
  return `When ${midSentence}${condition} → ${action}`
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
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/dashboard/activity" style={{ fontSize: 13, color: '#6B7280', textDecoration: 'none', border: '1px solid #E5E7EB', borderRadius: 6, padding: '0.35rem 0.75rem' }}>
            Activity
          </a>
          <a href="/dashboard" style={{ fontSize: 13, color: '#6B7280', textDecoration: 'none', border: '1px solid #E5E7EB', borderRadius: 6, padding: '0.35rem 0.75rem' }}>
            Connections
          </a>
          <a href="/dashboard/settings" style={{ fontSize: 13, color: '#6B7280', textDecoration: 'none', border: '1px solid #E5E7EB', borderRadius: 6, padding: '0.35rem 0.75rem' }}>
            Settings
          </a>
        </div>
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

/**
 * One step as the form holds it.
 *
 * Every field is kept per step rather than only the ones the current action
 * uses, so switching a step's type and switching back does not silently discard
 * what was typed.
 */
type StepDraft = {
  action_type: ActionType
  aiTask: AITask
  aiInstructions: string
  messageTemplate: string
  webhookUrl: string
}

function newStep(): StepDraft {
  return {
    action_type: 'slack_message',
    aiTask: 'summarize',
    aiInstructions: '',
    messageTemplate: '',
    webhookUrl: '',
  }
}

/**
 * Narrows a draft to what the API stores.
 *
 * `deliver_to` is deliberately never written. It is the pre-steps shape, where
 * an AI step had to carry its own delivery channel; a workflow built here says
 * that with a step instead.
 */
function toStep(d: StepDraft): Step {
  const action_config: StepConfig = {}

  if (d.action_type === 'slack_message' || d.action_type === 'notion_row') {
    if (d.messageTemplate.trim()) action_config.message_template = d.messageTemplate.trim()
  }
  if (d.action_type === 'webhook') action_config.url = d.webhookUrl.trim()
  if (d.action_type === 'ai_step') {
    action_config.ai_task = d.aiTask
    if (d.aiInstructions.trim()) action_config.ai_instructions = d.aiInstructions.trim()
  }

  return { action_type: d.action_type, action_config }
}


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
  const [steps, setSteps] = useState<StepDraft[]>([newStep()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) return setError('Give the workflow a name.')
    if (triggerType === 'deal_stale' && (!thresholdDays || Number(thresholdDays) <= 0)) {
      return setError('Enter a number of days for the staleness threshold.')
    }
    for (let i = 0; i < steps.length; i++) {
      const d = steps[i]
      const at = `Step ${i + 1}`

      if (d.action_type === 'webhook' && !d.webhookUrl.trim().startsWith('https://')) {
        return setError(`${at}: webhook URL must start with https://`)
      }
      if (d.action_type === 'slack_message' && !slackConnected) {
        return setError(`${at} sends to Slack — connect Slack first, see Connections.`)
      }
      if (d.action_type === 'notion_row' && !notionConnected) {
        return setError(`${at} writes to Notion — connect Notion first, see Connections.`)
      }

      // An AI step whose output nothing uses is a call you pay for that does
      // nothing. Caught here rather than discovered on the invoice.
      if (d.action_type === 'ai_step') {
        const ref = `{{step${i + 1}}}`
        const used = steps.slice(i + 1).some((later) => later.messageTemplate.includes(ref))
        if (!used) {
          return setError(
            `${at} writes something with AI, but no later step uses it. ` +
              `Add a step after it and put ${ref} in the message.`
          )
        }
      }
    }

    setSaving(true)
    const trigger_config: Record<string, unknown> = {}
    if (triggerType === 'deal_stage_changed' && toStage.trim()) trigger_config.to_stage = toStage.trim()
    if (triggerType === 'deal_stale') trigger_config.threshold_days = Number(thresholdDays)


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
        steps: steps.map(toStep),
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

  function updateStep(index: number, patch: Partial<StepDraft>) {
    setSteps(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)))
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
        <p style={{ fontSize: 12, color: '#9CA3AF', margin: '0 0 0.6rem' }}>
          Steps run in order. If one fails, the workflow stops there and retries
          from that step — the ones before it are not repeated.
        </p>

        {steps.map((step, i) => (
          <div
            key={i}
            style={{
              border: '1px solid #E5E7EB',
              borderRadius: 10,
              padding: '0.9rem 1rem',
              marginBottom: '0.6rem',
              background: '#F9FAFB',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', letterSpacing: '.04em' }}>
                STEP {i + 1}
              </span>
              {steps.length > 1 && (
                <button
                  type="button"
                  onClick={() => setSteps(steps.filter((_, n) => n !== i))}
                  style={{ fontSize: 12, color: '#6B7280', background: 'none', border: '1px solid #E5E7EB', borderRadius: 6, padding: '0.2rem 0.55rem', cursor: 'pointer' }}
                >
                  Remove
                </button>
              )}
            </div>

            <select
              style={{ ...inputStyle, marginBottom: '0.7rem' }}
              value={step.action_type}
              onChange={(e) => updateStep(i, { action_type: e.target.value as ActionType })}
            >
              <option value="slack_message">Send a Slack message {!slackConnected && '(connect Slack first)'}</option>
              <option value="notion_row">Add a Notion row {!notionConnected && '(connect Notion first)'}</option>
              <option value="webhook">Call a webhook</option>
              <option value="ai_step">Ask AI to write something</option>
            </select>

            {step.action_type === 'ai_step' && (
              <>
                <label style={labelStyle}>What should the AI do?</label>
                <select
                  style={{ ...inputStyle, marginBottom: '0.7rem' }}
                  value={step.aiTask}
                  onChange={(e) => updateStep(i, { aiTask: e.target.value as AITask })}
                >
                  {(Object.keys(AI_TASK_LABELS) as AITask[]).map((t) => (
                    <option key={t} value={t}>{AI_TASK_LABELS[t]}</option>
                  ))}
                </select>

                <label style={labelStyle}>Anything specific to tell it? (optional)</label>
                <textarea
                  style={{ ...inputStyle, minHeight: 60, fontFamily: 'inherit', resize: 'vertical' }}
                  value={step.aiInstructions}
                  onChange={(e) => updateStep(i, { aiInstructions: e.target.value })}
                  maxLength={500}
                  placeholder="Keep it under three sentences and mention our Q1 pricing change."
                />
                <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: '0.375rem' }}>
                  Writes text for a later step to send — add a Slack or Notion step
                  after this one and use {`{{step${i + 1}}}`} in its message. The AI only
                  sees the deal name, stage, owner and how long it has been quiet, never
                  contact details or note contents.
                </p>
              </>
            )}

            {(step.action_type === 'slack_message' || step.action_type === 'notion_row') && (
              <>
                <label style={labelStyle}>
                  {step.action_type === 'slack_message'
                    ? 'Message (optional — leave blank for a default message)'
                    : 'Notes column (optional)'}
                </label>
                <textarea
                  style={{ ...inputStyle, minHeight: 70, fontFamily: 'inherit', resize: 'vertical' }}
                  value={step.messageTemplate}
                  onChange={(e) => updateStep(i, { messageTemplate: e.target.value })}
                  placeholder={
                    i > 0
                      ? `{{step${i}}}`
                      : '{{deal_name}} moved to {{stage}} — owned by {{owner}}. {{link}}'
                  }
                />
                <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: '0.375rem' }}>
                  Placeholders: {'{{deal_name}}'}, {'{{stage}}'}, {'{{owner}}'}, {'{{link}}'}
                  {i > 0 && <> — and {Array.from({ length: i }, (_, n) => `{{step${n + 1}}}`).join(', ')} for what earlier steps produced</>}
                </p>
              </>
            )}

            {step.action_type === 'webhook' && (
              <>
                <label style={labelStyle}>Webhook URL</label>
                <input
                  style={inputStyle}
                  value={step.webhookUrl}
                  onChange={(e) => updateStep(i, { webhookUrl: e.target.value })}
                  placeholder="https://your-endpoint.example.com/hook"
                />
              </>
            )}
          </div>
        ))}

        {steps.length < MAX_STEPS ? (
          <button
            type="button"
            onClick={() => setSteps([...steps, newStep()])}
            style={{ fontSize: 13, fontWeight: 500, color: '#1A56DB', background: 'none', border: '1px dashed #C7D7F5', borderRadius: 8, padding: '0.5rem 0.9rem', cursor: 'pointer', width: '100%' }}
          >
            + Add a step
          </button>
        ) : (
          <p style={{ fontSize: 12, color: '#9CA3AF', margin: 0 }}>
            {MAX_STEPS} steps is the maximum.
          </p>
        )}
      </div>

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
