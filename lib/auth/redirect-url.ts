import { Capacitor } from '@capacitor/core'
import { getSiteUrl } from '@/lib/site-url'
import { AUTH_NATIVE_CALLBACK_URL } from '@/lib/auth/constants'

/**
 * Redirect URL for Supabase magic-link emails.
 *
 * Manual Supabase dashboard step (cannot be done from app code):
 * Authentication → URL Configuration → Additional Redirect URLs
 * Add: com.trackbase.app://auth/callback
 *
 * Without this, Supabase rejects the native redirect and magic links fail validation.
 */
export function getAuthRedirectUrl(): string {
  if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
    return AUTH_NATIVE_CALLBACK_URL
  }
  return `${getSiteUrl()}/auth/callback`
}
