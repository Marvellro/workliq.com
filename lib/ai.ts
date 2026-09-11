import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { getSupabaseAdmin } from './config'
import {
  AI_MODEL,
  computeCost,
  estimateMaxCost,
  checkBudget,
  formatUsd,
  type BudgetState,
} from './ai-pricing'

// AI workflow steps.
//
// This is the only place in Workliq that sends customer data to a third-party
// model, so the boundaries are drawn explicitly here rather than left to each
// call site:
//
//   • Data minimisation — a fixed, small set of deal fields is sent. Never
//     contact records, emails, phone numbers, or note bodies. See buildDealFacts.
//   • Spend — every call is metered and checked against the customer's monthly
//     budget beforehand, and fails closed above it.
//   • Output shape — structured outputs, so the engine gets typed data rather
//     than prose it has to parse.

export class AIBudgetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AIBudgetError'
  }
}

export class AIConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AIConfigError'
  }
}

export type AITask = 'summarize' | 'draft_followup' | 'score_lead' | 'next_action'

export const AI_TASKS: AITask[] = ['summarize', 'draft_followup', 'score_lead', 'next_action']

export const AI_TASK_LABELS: Record<AITask, string> = {
  summarize: 'Summarise the deal',
  draft_followup: 'Draft a follow-up email',
  score_lead: 'Score the deal',
  next_action: 'Recommend the next action',
}

// Caps the response. Each task produces a short, human-readable artefact — a
// paragraph or a short email — not an essay, and an unbounded ceiling would
// make the pre-flight cost estimate meaningless.
const MAX_OUTPUT_TOKENS = 1200

// Refuses absurd inputs before spending anything. Nothing legitimate in a deal
// summary approaches this; hitting it means something is wrong with the input.
const MAX_INPUT_TOKENS = 20_000

// ── The facts we send ────────────────────────────────────────────────────────

/**
 * The complete set of deal information sent to the model.
 *
 * Defined as an explicit type rather than passing a HubSpot object through, so
 * that adding a field to the deal fetch cannot silently start shipping it to a
 * third party. Everything here is business metadata about a deal; none of it is
 * personal contact information.
 */
export type DealFacts = {
  dealName: string
  stage: string
  owner: string
  triggerDescription: string
  daysSinceLastActivity?: number
}

function buildDealFacts(facts: DealFacts): string {
  const lines = [
    `Deal name: ${facts.dealName}`,
    `Current stage: ${facts.stage}`,
    `Owner: ${facts.owner}`,
    `What just happened: ${facts.triggerDescription}`,
  ]
  if (facts.daysSinceLastActivity !== undefined) {
    lines.push(`Days since last activity: ${facts.daysSinceLastActivity}`)
  }
  return lines.join('\n')
}

// ── Prompts ──────────────────────────────────────────────────────────────────

// A shared preamble, kept identical across tasks so it forms a stable cacheable
// prefix. Caching is a prefix match — any byte that differs invalidates
// everything after it — so anything varying per call belongs in the user
// message, never here.
const SYSTEM_PREAMBLE = `You are an assistant inside Workliq, a CRM automation tool used by B2B sales and revenue-operations teams. You receive a small set of facts about a single HubSpot deal and produce one short, immediately useful piece of writing for the sales rep who owns it.

House rules, which apply to every task:

- Write for a busy salesperson who will read this in Slack between meetings. Lead with the point. No preamble, no restating the question, no sign-off like "Let me know if you need anything else".
- Use only the facts you are given. You will often be given very little — that is normal and expected. Never invent a contact name, a company detail, a past conversation, a number, or a date that was not provided.
- When the facts are too thin to say something useful, say so plainly in one line rather than padding with generic sales advice. "No activity recorded since the stage change — worth a direct check-in" is a good answer. Three paragraphs of filler is not.
- Never speculate about a person's intent, seniority, budget, or state of mind. You have not spoken to them.
- Plain sentences. No headings, no bullet-point lists unless the task explicitly asks for steps, no emoji, no marketing language, no exclamation marks.
- Deal stage values are raw HubSpot internal identifiers such as "appointmentscheduled" or "closedwon". Read them as stage names and refer to them in ordinary words.`

const TASK_INSTRUCTIONS: Record<AITask, string> = {
  summarize: `Task: write a two-to-three sentence summary of where this deal stands and what is notable about its current state. Factual, not motivational.`,

  draft_followup: `Task: draft a short follow-up email the deal owner could send. Three to five sentences in the body. Specific to the stage the deal is in and how long it has been quiet. Do not invent a recipient name — address it generically if no name was provided. No subject-line clichés ("Touching base", "Circling back", "Just checking in").`,

  score_lead: `Task: judge how much attention this deal needs right now, on a 0-100 scale where 100 means it needs attention urgently. Base the judgement only on the stage and the activity gap you were given. State the single clearest reason in one sentence.`,

  next_action: `Task: recommend the one specific next action the deal owner should take, and say why in a single sentence. One action, not a list of options.`,
}

// ── Output schemas ───────────────────────────────────────────────────────────

// Structured outputs rather than free text: the engine needs to route a score
// differently from an email body, and parsing that back out of prose would be
// guesswork that breaks the first time the model words something differently.

const SummarySchema = z.object({
  summary: z.string().describe('Two to three sentences on where the deal stands.'),
})

const FollowupSchema = z.object({
  subject: z.string().describe('Email subject line. Specific, no clichés.'),
  body: z.string().describe('Email body, three to five sentences.'),
})

const ScoreSchema = z.object({
  score: z.number().min(0).max(100).describe('0-100, where 100 needs attention most urgently.'),
  reason: z.string().describe('One sentence explaining the score.'),
})

const NextActionSchema = z.object({
  action: z.string().describe('The single next action to take.'),
  rationale: z.string().describe('One sentence on why.'),
})

const SCHEMAS = {
  summarize: SummarySchema,
  draft_followup: FollowupSchema,
  score_lead: ScoreSchema,
  next_action: NextActionSchema,
} as const

export type AIResult =
  | { task: 'summarize'; summary: string }
  | { task: 'draft_followup'; subject: string; body: string }
  | { task: 'score_lead'; score: number; reason: string }
  | { task: 'next_action'; action: string; rationale: string }

/** Renders any task result as the message text delivered to Slack / Notion. */
export function renderResult(result: AIResult): string {
  switch (result.task) {
    case 'summarize':
      return result.summary
    case 'draft_followup':
      return `*${result.subject}*\n\n${result.body}`
    case 'score_lead':
      return `Attention score: *${result.score}/100*\n${result.reason}`
    case 'next_action':
      return `*Next action:* ${result.action}\n${result.rationale}`
  }
}

// ── Client ───────────────────────────────────────────────────────────────────

let client: Anthropic | null = null

function getClient(): Anthropic {
  if (client) return client
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AIConfigError(
      'ANTHROPIC_API_KEY is not set — AI steps cannot run. Add it in the Vercel project settings.'
    )
  }
  client = new Anthropic()
  return client
}

// ── The metered call ─────────────────────────────────────────────────────────

export type RunAIParams = {
  customerId: string
  workflowId: string
  jobId?: string
  task: AITask
  facts: DealFacts
  /** Optional extra guidance from the customer's workflow config. */
  instructions?: string
}

/**
 * Runs one AI step: checks the budget, calls the model, records the spend.
 *
 * Spend is recorded whether or not the call succeeds. A call that fails after
 * the model has read the input is still billed by Anthropic, so omitting those
 * rows would under-report what the customer actually costs us.
 */
export async function runAIStep(params: RunAIParams): Promise<AIResult> {
  const anthropic = getClient()

  const system = `${SYSTEM_PREAMBLE}\n\n${TASK_INSTRUCTIONS[params.task]}`
  const userContent = params.instructions
    ? `${buildDealFacts(params.facts)}\n\nAdditional instruction from the deal owner: ${params.instructions}`
    : buildDealFacts(params.facts)

  // ── Pre-flight: how big is this, and can they afford it? ──────────────────
  let inputTokens: number
  try {
    const counted = await anthropic.messages.countTokens({
      model: AI_MODEL,
      system,
      messages: [{ role: 'user', content: userContent }],
    })
    inputTokens = counted.input_tokens
  } catch {
    // Token counting is a convenience, not a gate. If it is unavailable, fall
    // back to a conservative estimate (~4 chars per token, rounded up) rather
    // than failing the step — the budget check below still applies.
    inputTokens = Math.ceil((system.length + userContent.length) / 3)
  }

  if (inputTokens > MAX_INPUT_TOKENS) {
    throw new AIConfigError(
      `This step's input is ${inputTokens} tokens, over the ${MAX_INPUT_TOKENS} limit.`
    )
  }

  const budget = await getBudgetState(params.customerId)
  const estimate = estimateMaxCost(AI_MODEL, inputTokens, MAX_OUTPUT_TOKENS)
  const decision = checkBudget(budget, estimate)
  if (!decision.allowed) {
    throw new AIBudgetError(decision.reason)
  }

  // ── The call ──────────────────────────────────────────────────────────────
  try {
    const response = await anthropic.messages.parse({
      model: AI_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      // Adaptive thinking, at low effort. These are short, well-specified
      // writing tasks — the quality gain from more deliberation is small and
      // the cost and latency are paid on every deal that fires a workflow.
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'low',
        format: zodOutputFormat(SCHEMAS[params.task]),
      },
      // The system prompt is identical for every customer running this task, so
      // it is worth caching. Whether it actually caches depends on the model's
      // minimum cacheable prefix — usage.cache_read_input_tokens is recorded in
      // ai_usage either way, which is how we can tell rather than assume.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    })

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    }
    const cost = computeCost(AI_MODEL, usage)

    await recordUsage({ ...params, usage, cost, succeeded: true })

    // parsed_output is null when the response didn't satisfy the schema.
    if (!response.parsed_output) {
      throw new Error('Model response did not match the expected output shape')
    }

    return { task: params.task, ...response.parsed_output } as AIResult
  } catch (err) {
    if (err instanceof AIBudgetError || err instanceof AIConfigError) throw err

    // Record the attempt even on failure, so spend isn't under-reported.
    await recordUsage({
      ...params,
      usage: { inputTokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      cost: computeCost(AI_MODEL, { inputTokens, outputTokens: 0 }),
      succeeded: false,
      error: err instanceof Error ? err.message : String(err),
    })

    // Typed SDK errors, most-specific first, so the queue can tell a transient
    // failure worth retrying from a permanent one that never will be.
    if (err instanceof Anthropic.AuthenticationError) {
      throw new AIConfigError('The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.')
    }
    if (err instanceof Anthropic.BadRequestError) {
      throw new AIConfigError(`The model rejected this request: ${err.message}`)
    }
    throw err
  }
}

async function getBudgetState(customerId: string): Promise<BudgetState> {
  const { data, error } = await getSupabaseAdmin().rpc('ai_spend_this_month', {
    p_customer_id: customerId,
  })

  if (error) {
    // Fail closed: without knowing the spend we cannot assert the call is
    // within budget, and guessing risks billing past a ceiling the customer set.
    throw new AIBudgetError(`Could not read the AI budget: ${error.message}`)
  }

  const row = Array.isArray(data) ? data[0] : data
  return {
    spentUsd: Number(row?.spent_usd ?? 0),
    budgetUsd: Number(row?.budget_usd ?? 0),
    remainingUsd: Number(row?.remaining_usd ?? 0),
  }
}

async function recordUsage(args: {
  customerId: string
  workflowId: string
  jobId?: string
  task: AITask
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
  cost: number
  succeeded: boolean
  error?: string
}): Promise<void> {
  const { error } = await getSupabaseAdmin().from('ai_usage').insert({
    customer_id: args.customerId,
    workflow_id: args.workflowId,
    job_id: args.jobId ?? null,
    task: args.task,
    model: AI_MODEL,
    input_tokens: args.usage.inputTokens,
    output_tokens: args.usage.outputTokens,
    cache_read_tokens: args.usage.cacheReadTokens,
    cache_write_tokens: args.usage.cacheWriteTokens,
    cost_usd: args.cost,
    succeeded: args.succeeded,
    error_message: args.error ?? null,
  })

  if (error) {
    // Loud, because an unmetered call is spend we cannot see or bill for.
    console.error('[ai] FAILED TO RECORD USAGE — spend is unmetered:', error.message)
  }
}

export { formatUsd }
