import { NextResponse, type NextRequest } from 'next/server'

const ADMIN_EMAILS = [
  'marvellousjunioro@gmail.com',
]

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── Admin routes ──────────────────────────────────────────────────────────
  if (pathname.startsWith('/admin')) {
    const adminEmail = request.cookies.get('admin-email')?.value
    if (!adminEmail || !ADMIN_EMAILS.includes(adminEmail)) {
      return NextResponse.redirect(new URL('/', request.url))
    }
    return NextResponse.next()
  }

  // ── Customer dashboard routes ──────────────────────────────────────────────
  // /dashboard/login is the entry point — allow it through unconditionally so
  // unauthenticated users can reach the login form without a redirect loop.
  if (pathname.startsWith('/dashboard') && pathname !== '/dashboard/login') {
    const hasSession =
      request.cookies.has('sb-access-token') &&
      request.cookies.has('sb-refresh-token')

    if (!hasSession) {
      return NextResponse.redirect(new URL('/dashboard/login', request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*', '/dashboard/:path*'],
}
