import { NextResponse, type NextRequest } from 'next/server'
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '@/lib/config'

// Redirect convenience only — NOT a security boundary.
//
// Next's own documentation notes that proxy "is meant to be invoked separately
// of your render code and in optimized cases deployed to your CDN", so nothing
// may assume it ran. It also only sees whether cookies are *present*; verifying
// a JWT signature needs the JWKS fetch that lib/session.ts performs.
//
// So this file exists purely to bounce a signed-out visitor to a login page
// instead of showing them an empty dashboard. Real enforcement lives in:
//   • lib/session.ts   — verifies the session JWT
//   • lib/admin.ts     — checks the `admins` table server-side
//   • each route handler and page, which calls one of those itself
//
// The previous version was the only thing standing between the internet and
// /api/admin/invite, and its matcher didn't cover /api/* at all.

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const hasSessionCookies =
    request.cookies.has(ACCESS_TOKEN_COOKIE) ||
    request.cookies.has(REFRESH_TOKEN_COOKIE)

  // /admin pages: bounce anonymous visitors to the admin login. Whether the
  // signed-in user is actually an admin is decided server-side by requireAdmin.
  if (pathname.startsWith('/admin')) {
    if (!hasSessionCookies) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return NextResponse.next()
  }

  // /dashboard/login is the entry point — allow it through unconditionally so
  // unauthenticated users can reach the login form without a redirect loop.
  if (pathname.startsWith('/dashboard') && pathname !== '/dashboard/login') {
    if (!hasSessionCookies) {
      return NextResponse.redirect(new URL('/dashboard/login', request.url))
    }
  }

  return NextResponse.next()
}

// API routes are deliberately absent from this matcher. They authenticate
// themselves; adding them here would invite the assumption that they don't
// have to.
export const config = {
  matcher: ['/admin/:path*', '/dashboard/:path*'],
}
