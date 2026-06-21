import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCustomerSession } from '@/lib/session'

const NOTION_CLIENT_ID = '386d872b-594c-8162-84f2-00370d6f32cc'
const NOTION_REDIRECT_URI = 'https://workliq.com/api/auth/notion/callback'
const NOTION_VERSION = '2022-06-28'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://workliq.com'

type NotionTokenResponse = {
  access_token: string
  workspace_id: string
  workspace_name: string
  workspace_icon: string | null
  bot_id: string
  owner: { type: string; user?: { id: string } }
  // Notion does not issue a refresh_token — access tokens don't expire
}

type NotionPage = {
  id: string
  object: 'page'
}

type NotionSearchResponse = {
  results: NotionPage[]
  has_more: boolean
}

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function parseCookieValue(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)
  )
  return match ? decodeURIComponent(match[1]) : null
}

// Builds the Notion API request headers used in every call after token exchange
function notionHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION,
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const errorParam = searchParams.get('error')

  if (errorParam) {
    console.error('Notion OAuth denied:', errorParam)
    return NextResponse.redirect(`${APP_URL}/dashboard?error=notion_denied`)
  }

  if (!code || !state) {
    console.error('Notion callback missing code or state')
    return NextResponse.redirect(`${APP_URL}/dashboard?error=notion_invalid`)
  }

  const cookieHeader = req.headers.get('cookie') ?? ''
  const storedState = parseCookieValue(cookieHeader, 'notion_oauth_state')

  if (!storedState || storedState !== state) {
    console.error('Notion OAuth state mismatch — possible CSRF')
    return NextResponse.redirect(`${APP_URL}/dashboard?error=notion_state_mismatch`)
  }

  const session = await getCustomerSession()
  if (!session) {
    return NextResponse.redirect(`${APP_URL}/dashboard/login`)
  }

  // ── Step 1: Exchange code for access token ────────────────────────────────
  // Notion requires HTTP Basic Auth (client_id:client_secret) on the token endpoint.
  let tokenData: NotionTokenResponse
  try {
    const credentials = Buffer.from(
      `${NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`
    ).toString('base64')

    const tokenRes = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: NOTION_REDIRECT_URI,
      }),
    })

    if (!tokenRes.ok) {
      const errText = await tokenRes.text()
      console.error('Notion token exchange failed:', tokenRes.status, errText)
      return NextResponse.redirect(`${APP_URL}/dashboard?error=notion_token_failed`)
    }

    tokenData = await tokenRes.json()
  } catch (err) {
    console.error('Notion token exchange network error:', err)
    return NextResponse.redirect(`${APP_URL}/dashboard?error=notion_token_failed`)
  }

  // ── Step 2: Find the parent page the customer granted access to ───────────
  // After OAuth, the bot can only see pages the customer explicitly shared.
  // We search for accessible pages and use the first result as the database
  // parent — in practice this will be the one page they picked on the consent
  // screen for a fresh install.
  let parentPageId: string
  try {
    const searchRes = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: notionHeaders(tokenData.access_token),
      body: JSON.stringify({
        filter: { value: 'page', property: 'object' },
        page_size: 1,
      }),
    })

    if (!searchRes.ok) {
      const errText = await searchRes.text()
      console.error('Notion page search failed:', searchRes.status, errText)
      return NextResponse.redirect(`${APP_URL}/dashboard?error=notion_page_failed`)
    }

    const searchData: NotionSearchResponse = await searchRes.json()

    if (!searchData.results.length) {
      // The customer didn't grant access to any page — shouldn't happen in the
      // normal consent flow, but handle it gracefully.
      console.error('Notion search returned no accessible pages for customer', session.customerId)
      return NextResponse.redirect(`${APP_URL}/dashboard?error=notion_no_page`)
    }

    parentPageId = searchData.results[0].id
  } catch (err) {
    console.error('Notion page search network error:', err)
    return NextResponse.redirect(`${APP_URL}/dashboard?error=notion_page_failed`)
  }

  // ── Step 3: Auto-create the "Workliq Stale Deals" database ───────────────
  // Schema is fixed — always matches what the cron job expects to write.
  // Status is included but Workliq only sets it to "New" at creation time and
  // never overwrites it — that field belongs to the customer for their triage.
  let databaseId: string
  try {
    const createRes = await fetch('https://api.notion.com/v1/databases', {
      method: 'POST',
      headers: notionHeaders(tokenData.access_token),
      body: JSON.stringify({
        parent: { type: 'page_id', page_id: parentPageId },
        title: [{ type: 'text', text: { content: 'Workliq Stale Deals' } }],
        properties: {
          // Title is always first and is the Notion "name" property
          'Deal Name':   { title: {} },
          'Stage':       { select: { options: [] } },
          // Notion uses "rich_text" for freeform text fields (called "Text" in the UI)
          'Owner':       { rich_text: {} },
          'Days Stale':  { number: { format: 'number' } },
          'Threshold':   {
            select: {
              options: [
                { name: '3',  color: 'gray' },
                { name: '7',  color: 'yellow' },
                { name: '14', color: 'orange' },
                { name: '30', color: 'red' },
              ],
            },
          },
          'Flagged On':  { date: {} },
          'HubSpot Link': { url: {} },
          'Status': {
            select: {
              options: [
                { name: 'New',          color: 'blue' },
                { name: 'Acknowledged', color: 'yellow' },
                { name: 'Resolved',     color: 'green' },
              ],
            },
          },
        },
      }),
    })

    if (!createRes.ok) {
      const errText = await createRes.text()
      console.error('Notion database creation failed:', createRes.status, errText)
      return NextResponse.redirect(`${APP_URL}/dashboard?error=notion_db_create_failed`)
    }

    const createData = await createRes.json()
    databaseId = createData.id
  } catch (err) {
    console.error('Notion database creation network error:', err)
    return NextResponse.redirect(`${APP_URL}/dashboard?error=notion_db_create_failed`)
  }

  // ── Step 4: Persist the connection ────────────────────────────────────────
  const { error: dbError } = await getSupabaseAdmin()
    .from('notion_connections')
    .upsert(
      {
        customer_id:    session.customerId,
        access_token:   tokenData.access_token,
        workspace_id:   tokenData.workspace_id,
        workspace_name: tokenData.workspace_name,
        database_id:    databaseId,
        parent_page_id: parentPageId,
        updated_at:     new Date().toISOString(),
      },
      { onConflict: 'customer_id' }
    )

  if (dbError) {
    console.error('Failed to store Notion connection:', dbError)
    return NextResponse.redirect(`${APP_URL}/dashboard?error=notion_db_failed`)
  }

  const response = NextResponse.redirect(`${APP_URL}/dashboard?connected=notion`)
  response.cookies.set('notion_oauth_state', '', { maxAge: 0, path: '/' })
  return response
}
