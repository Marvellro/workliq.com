import { NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/session'
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '@/lib/config'
import { recordAudit, clientIp, userAgent } from '@/lib/audit'

export async function POST(req: Request) {
  // Read the session before clearing so the audit entry can attribute the
  // logout. A failure here must not stop the cookies being cleared.
  const session = await getCustomerSession().catch(() => null)

  const response = NextResponse.json({ success: true })
  response.cookies.set(ACCESS_TOKEN_COOKIE, '', { maxAge: 0, path: '/' })
  response.cookies.set(REFRESH_TOKEN_COOKIE, '', { maxAge: 0, path: '/' })
  // Clear the legacy admin cookie too, so no browser keeps carrying one.
  response.cookies.set('admin-email', '', { maxAge: 0, path: '/' })

  if (session) {
    await recordAudit({
      action: 'customer.logout',
      customerId: session.customerId,
      actor: session.email,
      ip: clientIp(req),
      userAgent: userAgent(req),
    })
  }

  return response
}
