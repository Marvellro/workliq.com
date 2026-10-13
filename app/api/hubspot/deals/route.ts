import { NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/session'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getValidHubSpotToken } from '@/lib/hubspot'
import { fetchRecentDeals } from '@/lib/hubspot-deals'
import { ConnectionError, markConnectionUnhealthy } from '@/lib/connection-health'

// The customer's most recently modified HubSpot deals, for the "Send a test"
// picker. Returns only what a picker shows — id, name, stage — and nothing
// else from the deal, because nothing else is needed to choose one.

export async function GET() {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limit = await checkRateLimit(`deal-lookup:${session.customerId}`, RATE_LIMITS.dealLookup)
  if (!limit.allowed) return rateLimitResponse(limit)

  try {
    const token = await getValidHubSpotToken(session.customerId)
    const deals = await fetchRecentDeals(session.customerId, token, 20)
    return NextResponse.json({
      deals: deals.map((d) => ({
        id: d.id,
        name: d.properties.dealname ?? 'Unnamed deal',
        stage: d.properties.dealstage,
      })),
    })
  } catch (err) {
    if (err instanceof ConnectionError) {
      await markConnectionUnhealthy(err)
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    console.error('[hubspot-deals] lookup failed:', err)
    return NextResponse.json({ error: 'Could not load your HubSpot deals.' }, { status: 502 })
  }
}
