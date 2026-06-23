import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { ACCESS_COOKIE, REFRESH_COOKIE, decodeJwt, refreshAccessToken } from '@/lib/auth/session'
import LandingPage from '@/components/LandingPage'

export default async function Home() {
  const cookieStore = await cookies()
  let token = cookieStore.get(ACCESS_COOKIE)?.value ?? null
  let payload = token ? decodeJwt(token) : null

  if (!payload) {
    const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value
    if (refreshToken) {
      const refreshed = await refreshAccessToken(refreshToken)
      if (refreshed) {
        payload = decodeJwt(refreshed.access_token)
      }
    }
  }

  if (payload) {
    redirect('/dashboard')
  }

  return <LandingPage signInHref="/auth" />
}
