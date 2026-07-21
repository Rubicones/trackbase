'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { getSupabaseClient } from '@/lib/supabase/client'
import { setAuthCookies, clearAuthCookies } from '@/lib/auth/cookies'
import { syncSupabaseRealtimeAuth } from '@/lib/supabase/realtime-auth'
import { trackEvent } from '@/lib/analytics'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OnboardingData {
  dashboard_seen?: boolean
  band_seen?: boolean
  project_tour_completed?: boolean
  project_tour_skipped?: boolean
  mobile_project_tour_completed?: boolean
  mobile_project_tour_skipped?: boolean
  compare_tour_completed?: boolean
  compare_tour_skipped?: boolean
  structure_tour_completed?: boolean
  structure_tour_skipped?: boolean
  cherrypick_tour_completed?: boolean
  cherrypick_tour_skipped?: boolean
  track_edit_tour_completed?: boolean
  track_edit_tour_skipped?: boolean
}

export interface Profile {
  id: string
  username: string
  display_name: string | null
  avatar_color: string | null
  onboarding: OnboardingData
}

interface AuthState {
  user: User | null
  profile: Profile | null
  session: Session | null
  loading: boolean
}

interface AuthContextValue extends AuthState {
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  updateOnboarding: (key: keyof OnboardingData, value: boolean) => Promise<void>
}

// Profile fetch is retried on transient failure so the avatar/dropdown doesn't
// vanish on a flaky first load. Backoff grows linearly: 300ms, 600ms.
const PROFILE_FETCH_RETRIES = 3
const PROFILE_FETCH_BACKOFF_MS = 300

// Upper bound for the initial getSession() call. A stale/expired refresh token
// can make the Supabase client stall (or throw) while it tries to recover the
// session — without a cap, `loading` would stay true forever and the app renders
// skeletons indefinitely with no requests firing. On timeout we fall back to the
// HttpOnly-cookie bootstrap, which the server refreshes independently.
const GET_SESSION_TIMEOUT_MS = 4000

/** Reject after `ms` so a hung promise can't stall session init forever. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}

/** A stored session whose access token has already expired (10s safety margin). */
function isSessionExpired(session: Session): boolean {
  if (!session.expires_at) return false
  return Date.now() / 1000 > session.expires_at - 10
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  session: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
  updateOnboarding: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    session: null,
    loading: true,
  })

  const supabase = getSupabaseClient()

  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    // The profile query can transiently fail (network blip, token still refreshing,
    // or a just-signed-up row the DB trigger hasn't materialised yet). Previously any
    // failure returned null, leaving `profile` null so the avatar/dropdown silently
    // disappeared until a manual reload. Retry a few times with backoff, and only give
    // up early when the row genuinely does not exist (PostgREST "no rows" = PGRST116).
    for (let attempt = 0; attempt < PROFILE_FETCH_RETRIES; attempt++) {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_color, onboarding')
        .eq('id', userId)
        .single()

      if (data) {
        return { ...data, onboarding: (data.onboarding as OnboardingData) ?? {} }
      }
      if (error?.code === 'PGRST116') return null // definitively no such row

      if (attempt < PROFILE_FETCH_RETRIES - 1) {
        await new Promise(r => setTimeout(r, PROFILE_FETCH_BACKOFF_MS * (attempt + 1)))
      }
    }
    return null
  }, [supabase])

  const refreshProfile = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const profile = await fetchProfile(user.id)
    setState(prev => ({ ...prev, profile }))
  }, [supabase, fetchProfile])

  const updateOnboarding = useCallback(async (key: keyof OnboardingData, value: boolean) => {
    // Optimistic local update
    setState(prev => {
      if (!prev.profile) return prev
      return {
        ...prev,
        profile: {
          ...prev.profile,
          onboarding: { ...prev.profile.onboarding, [key]: value },
        },
      }
    })
    // Persist to server
    await fetch('/api/profile/onboarding', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    })
  }, [])

  const signOut = useCallback(async () => {
    // Local scope only — global signOut revokes every refresh token (all devices).
    await supabase.auth.signOut({ scope: 'local' })
    await clearAuthCookies()
    setState({ user: null, profile: null, session: null, loading: false })
    trackEvent('signed_out')
  }, [supabase])

  useEffect(() => {
    let cancelled = false
    const syncingRef = { current: false }

    // Recover a session from the HttpOnly auth cookies. The server refreshes the
    // cookie tokens independently of localStorage, so this works even when the
    // client's stored refresh token has gone stale (the exact case that used to
    // hang the app on an old tab / relaunched PWA). Returns true when a session
    // was established and state was set.
    async function bootstrapFromCookies(): Promise<boolean> {
      try {
        const res = await fetch('/api/auth/session', { credentials: 'same-origin' })
        if (!res.ok) return false
        const tokens = (await res.json()) as { access_token?: string; refresh_token?: string }
        if (!tokens.access_token || !tokens.refresh_token) return false
        const { data, error } = await supabase.auth.setSession({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
        })
        if (error || !data.session) return false
        if (cancelled) return true
        await setAuthCookies(data.session)
        await syncSupabaseRealtimeAuth(data.session.access_token)
        const profile = await fetchProfile(data.session.user.id)
        if (cancelled) return true
        setState({ user: data.session.user, profile, session: data.session, loading: false })
        return true
      } catch {
        return false
      }
    }

    async function syncSession() {
      if (syncingRef.current) return
      syncingRef.current = true
      let resolved = false
      try {
        let existing: Session | null = null
        try {
          // Cap this call: a stale token can make it hang or throw. Either way we
          // stop waiting and fall through to the cookie bootstrap below.
          const { data } = await withTimeout(supabase.auth.getSession(), GET_SESSION_TIMEOUT_MS)
          existing = data.session
        } catch {
          existing = null
        }

        // Only trust a non-expired client session. An expired one would 401 every
        // query; recover via cookies instead (server-side refresh).
        if (existing && !isSessionExpired(existing)) {
          if (cancelled) { resolved = true; return }
          await setAuthCookies(existing)
          await syncSupabaseRealtimeAuth(existing.access_token)
          const profile = await fetchProfile(existing.user.id)
          if (cancelled) { resolved = true; return }
          setState({ user: existing.user, profile, session: existing, loading: false })
          resolved = true
          return
        }

        // No usable client session (missing, expired, or errored) — recover from
        // HttpOnly cookies.
        if (await bootstrapFromCookies()) resolved = true
      } finally {
        // Guarantee we always leave the loading state, even on an unexpected throw,
        // so the UI can proceed instead of showing skeletons forever.
        if (!resolved && !cancelled) setState(prev => ({ ...prev, loading: false }))
        syncingRef.current = false
      }
    }

    void syncSession()

    // An old tab or a relaunched PWA can resume with an expired in-memory session.
    // Re-sync when it becomes visible again so tokens/cookies refresh before the
    // next request, instead of silently 401-ing.
    function handleVisibility() {
      if (document.visibilityState === 'visible' && !cancelled && !syncingRef.current) {
        void syncSession()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // INITIAL_SESSION is handled by syncSession; avoid duplicate profile/cookie work.
        if (event === 'INITIAL_SESSION') return
        if (syncingRef.current) return
        syncingRef.current = true
        try {
          if (session) {
            await setAuthCookies(session)
            void syncSupabaseRealtimeAuth(session.access_token)
            const profile = await fetchProfile(session.user.id)
            if (!cancelled) {
              setState({ user: session.user, profile, session, loading: false })
            }
          } else {
            await clearAuthCookies()
            if (!cancelled) {
              setState({ user: null, profile: null, session: null, loading: false })
            }
          }
        } finally {
          syncingRef.current = false
        }
      },
    )

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibility)
      subscription.unsubscribe()
    }
  }, [supabase, fetchProfile])

  return (
    <AuthContext.Provider value={{ ...state, signOut, refreshProfile, updateOnboarding }}>
      {children}
    </AuthContext.Provider>
  )
}
