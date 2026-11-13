import { getSupabaseAdmin } from './config'
import { providerLabel, type ConnectionProvider } from './connection-health'
import type { WorkflowStep } from './workflow-steps'

// Which connections a workflow cannot run without.
//
// One rule, used in three places that must agree: Disconnect pauses the
// workflows that need what is being disconnected; turning a workflow on refuses
// while something it needs is missing; and creating or editing one refuses the
// same way. Before this existed, the only check was in the builder's browser
// code, so a workflow switched back on after its Slack was gone ran, failed on
// every deal, and reported each failure as a dead job.

export const CONNECTION_PROVIDERS = ['hubspot', 'slack', 'notion'] as const satisfies readonly ConnectionProvider[]

export function isConnectionProvider(value: unknown): value is ConnectionProvider {
  return typeof value === 'string' && (CONNECTION_PROVIDERS as readonly string[]).includes(value)
}

/**
 * The connections these steps need, in a fixed order.
 *
 * HubSpot is always among them: every trigger is a HubSpot deal event, so a
 * workflow without HubSpot has nothing that can ever start it.
 *
 * An AI step reaches Slack or Notion itself only through the legacy
 * `deliver_to` field — every workflow written before steps existed carries it.
 * Missing it here would leave those workflows running after their destination
 * was disconnected.
 */
export function providersUsedBy(steps: readonly WorkflowStep[]): ConnectionProvider[] {
  const used = new Set<ConnectionProvider>(['hubspot'])
  for (const step of steps) {
    const destination =
      step.action_type === 'ai_step' ? step.action_config?.deliver_to : step.action_type
    if (destination === 'slack_message') used.add('slack')
    if (destination === 'notion_row') used.add('notion')
  }
  return CONNECTION_PROVIDERS.filter((p) => used.has(p))
}

/**
 * A customer-facing reason these steps cannot run yet, or null when every
 * connection they need is in place.
 */
export function missingConnectionMessage(
  steps: readonly WorkflowStep[],
  connected: ReadonlySet<ConnectionProvider>
): string | null {
  const missing = providersUsedBy(steps).filter((p) => !connected.has(p))
  if (missing.length === 0) return null
  const names = missing.map(providerLabel)
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  return `This workflow uses ${list}, which ${missing.length === 1 ? 'is' : 'are'} not connected. Connect ${list} on the Connections page first.`
}

/**
 * Why this customer cannot run these steps yet, or null when they can.
 * Throws if the connections cannot be read; see connectedProviders.
 */
export async function connectionProblem(
  customerId: string,
  steps: readonly WorkflowStep[]
): Promise<string | null> {
  return missingConnectionMessage(steps, await connectedProviders(customerId))
}

/**
 * The providers this customer has a connection row for.
 *
 * A connection flagged needs_reauth still counts. It has a row and is one
 * reconnect from working, and the customer is already being told so; refusing
 * to let them turn a workflow on would add a second, vaguer message about the
 * same thing.
 *
 * Throws on a read error rather than answering "nothing connected": callers use
 * this to refuse a request, and refusing because the database blinked would
 * tell a customer to connect something they have connected.
 */
export async function connectedProviders(customerId: string): Promise<Set<ConnectionProvider>> {
  const supabase = getSupabaseAdmin()
  const results = await Promise.all(
    CONNECTION_PROVIDERS.map(async (provider) => {
      const { data, error } = await supabase
        .from(`${provider}_connections`)
        .select('id')
        .eq('customer_id', customerId)
        .maybeSingle()
      if (error) throw new Error(`Could not read ${provider} connection: ${error.message}`)
      return data ? provider : null
    })
  )
  return new Set(results.filter((p): p is ConnectionProvider => p !== null))
}
