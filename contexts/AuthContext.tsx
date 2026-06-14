'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { getSupabaseClient } from '@/lib/supabase/client'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OnboardingData {
  dashboard_seen?: boolean
  band_seen?: boolean
  project_tour_completed?: boolean
  project_tour_skipped?: boolean
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

// ─── Cookie helpers ───────────────────────────────────────────────────────────

const COOKIE_NAME = 'sb-at'

function setAuthCookie(token: string, expiresIn: number) {
  document.cookie = `${COOKIE_NAME}=${token}; path=/; SameSite=Lax; max-age=${expiresIn}`
}

function clearAuthCookie() {
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`
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
    const { data } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_color, onboarding')
      .eq('id', userId)
      .single()
    if (!data) return null
    return {
      ...data,
      onboarding: (data.onboarding as OnboardingData) ?? {},
    }
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
    clearAuthCookie()
    await supabase.auth.signOut()
    setState({ user: null, profile: null, session: null, loading: false })
  }, [supabase])

  useEffect(() => {
    // Initial session check
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        setAuthCookie(session.access_token, session.expires_in ?? 3600)
        const profile = await fetchProfile(session.user.id)
        setState({ user: session.user, profile, session, loading: false })
      } else {
        setState(prev => ({ ...prev, loading: false }))
      }
    })

    // Subscribe to auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session) {
          setAuthCookie(session.access_token, session.expires_in ?? 3600)
          const profile = await fetchProfile(session.user.id)
          setState({ user: session.user, profile, session, loading: false })
        } else {
          clearAuthCookie()
          setState({ user: null, profile: null, session: null, loading: false })
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [supabase, fetchProfile])

  return (
    <AuthContext.Provider value={{ ...state, signOut, refreshProfile, updateOnboarding }}>
      {children}
    </AuthContext.Provider>
  )
}
