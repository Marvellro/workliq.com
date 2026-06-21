import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

export type CustomerSession = {
  customerId: string
  email: string
}

// Returns the authenticated customer from the session cookies, or null if not
// logged in / session is invalid. Uses Supabase's setSession so the JWT is
// validated server-side without an extra DB round-trip.
export async function getCustomerSession(): Promise<CustomerSession | null> {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get('sb-access-token')?.value
  const refreshToken = cookieStore.get('sb-refresh-token')?.value

  if (!accessToken || !refreshToken) return null

  // Use the anon key here — setSession validates the JWT against Supabase's
  // auth server, so no elevated privileges are needed just to read identity.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })

  if (error || !data.user) return null

  return {
    customerId: data.user.id,
    email: data.user.email!,
  }
}
