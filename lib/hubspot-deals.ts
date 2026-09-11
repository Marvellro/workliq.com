// Shared HubSpot deal/owner fetching, used by both the stale-deals cron and
// the workflow engine cron. Extracted from stale-deals/route.ts so the two
// jobs don't maintain two copies of the same pagination logic.

export type HubSpotDeal = {
  id: string
  properties: {
    dealname: string | null
    dealstage: string | null
    hubspot_owner_id: string | null
    notes_last_updated: string | null // ISO 8601 datetime string, or null
  }
}

export type HubSpotOwner = {
  id: string
  firstName: string
  lastName: string
}

const DEAL_PROPERTIES = 'dealname,dealstage,hubspot_owner_id,notes_last_updated'

// Fetches all deals for a portal, paginating until HubSpot signals no more pages.
// Each page returns up to 100 deals; we request only the properties we use.
export async function fetchAllDeals(accessToken: string): Promise<HubSpotDeal[]> {
  const deals: HubSpotDeal[] = []
  let after: string | null = null

  do {
    const url = new URL('https://api.hubapi.com/crm/v3/objects/deals')
    url.searchParams.set('properties', DEAL_PROPERTIES)
    url.searchParams.set('limit', '100')
    if (after) url.searchParams.set('after', after)

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`HubSpot deals fetch failed (${res.status}): ${body}`)
    }

    const data = (await res.json()) as {
      results: HubSpotDeal[]
      paging?: { next?: { after: string } }
    }

    deals.push(...data.results)
    after = data.paging?.next?.after ?? null
  } while (after !== null)

  return deals
}

// Fetches all owners for a portal and returns a map of owner_id → full name.
// One call per customer, not per deal — avoids N+1 on large deal lists.
export async function fetchOwnerMap(accessToken: string): Promise<Map<string, string>> {
  const ownerMap = new Map<string, string>()

  const res = await fetch('https://api.hubapi.com/crm/v3/owners?limit=100', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    // Non-fatal — callers fall back to the raw owner ID.
    console.warn('HubSpot owners fetch failed:', res.status)
    return ownerMap
  }

  const data = (await res.json()) as { results: HubSpotOwner[] }
  for (const owner of data.results) {
    ownerMap.set(owner.id, `${owner.firstName} ${owner.lastName}`.trim())
  }

  return ownerMap
}

export function hubspotDealLink(hubId: string, dealId: string): string {
  return `https://app.hubspot.com/contacts/${hubId}/deal/${dealId}`
}

// Fetches a single deal by ID.
//
// Used by the webhook path: a notification carries only the object ID (plus the
// one property that changed), but building a useful alert needs the deal's name
// and owner too. Fetching one deal is far cheaper than the full pagination
// fetchAllDeals does, which is what the reconciliation sweep needs.
//
// Returns null for 404, which is normal rather than exceptional: a deal can be
// deleted between HubSpot emitting the event and us processing it.
export async function fetchDeal(
  accessToken: string,
  dealId: string
): Promise<HubSpotDeal | null> {
  const url = new URL(`https://api.hubapi.com/crm/v3/objects/deals/${encodeURIComponent(dealId)}`)
  url.searchParams.set('properties', DEAL_PROPERTIES)

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (res.status === 404) return null
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HubSpot deal fetch failed (${res.status}): ${body}`)
  }

  return (await res.json()) as HubSpotDeal
}
