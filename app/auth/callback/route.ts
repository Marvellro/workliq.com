import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')

  if (code) {
    return NextResponse.redirect(`${requestUrl.origin}/admin/waitlist`)
  }

  return NextResponse.redirect(`${requestUrl.origin}/login`)
}
