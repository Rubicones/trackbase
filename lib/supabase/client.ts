/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Singleton browser client.  Typed as `any` because we have no generated
// Database schema — all table queries are dynamically typed.
let _client: SupabaseClient<any> | null = null

export function getSupabaseClient(): SupabaseClient<any> {
  if (!_client) {
    const isBrowser = typeof window !== 'undefined'
    _client = createClient<any>(url, key, {
      auth: {
        persistSession: isBrowser,
        autoRefreshToken: isBrowser,
        detectSessionInUrl: isBrowser,
      },
    })
  }
  return _client as SupabaseClient<any>
}
