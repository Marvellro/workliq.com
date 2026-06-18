import { NextResponse, type NextRequest } from 'next/server'

const ADMIN_EMAILS = [
  'marvellousjunioro@gmail.com',
]

export async function middleware(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith('/admin')) {
    return NextResponse.next()
  }

  const adminEmail = request.cookies.get('admin-email')?.value

  if (!adminEmail || !ADMIN_EMAILS.includes(adminEmail)) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*'],
}
