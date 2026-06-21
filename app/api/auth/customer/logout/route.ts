import { NextResponse } from 'next/server'

export async function POST() {
  const response = NextResponse.json({ success: true })
  // Clear both session cookies by setting maxAge to 0
  response.cookies.set('sb-access-token', '', { maxAge: 0, path: '/' })
  response.cookies.set('sb-refresh-token', '', { maxAge: 0, path: '/' })
  return response
}
