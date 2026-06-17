/** Custom URL scheme registered in iOS Info.plist and Android AndroidManifest.xml. */
export const AUTH_DEEP_LINK_SCHEME = 'com.trackbase.app'

/** Redirect URL passed to Supabase for magic links opened from the native app. */
export const AUTH_NATIVE_CALLBACK_URL = `${AUTH_DEEP_LINK_SCHEME}://auth/callback`
