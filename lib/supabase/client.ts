/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Singleton browser client.  Typed as `any` because we have no generated
// Database schema — all table queries are dynamically typed.
let _client: SupabaseClient<any> | null = null

export function getSupabaseClient(): SupabaseClient<any> {
  if (typeof window === 'undefined') {
    throw new Error('getSupabaseClient() must only be called in the browser')
  }
  if (!_client) {
    _client = createClient<any>(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return _client as SupabaseClient<any>
}
