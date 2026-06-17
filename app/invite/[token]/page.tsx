'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AuthLoadingScreen } from '@/components/auth/AuthShell'

export default function LegacyInvitePage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/onboarding?step=3')
  }, [router])

  return <AuthLoadingScreen label="Redirecting" />
}
