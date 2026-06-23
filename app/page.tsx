import { cookies } from 'next/headers'
import { ACCESS_COOKIE, REFRESH_COOKIE, refreshAccessToken } from '@/lib/auth/session'
import { verifyAccessToken } from '@/lib/auth/verify'
import LandingPage from '@/components/LandingPage'

export default async function Home() {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value
  let isAuthenticated = false

  if (accessToken) {
    isAuthenticated = (await verifyAccessToken(accessToken)) !== null
  }

  if (!isAuthenticated) {
    const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value
    if (refreshToken) {
      const refreshed = await refreshAccessToken(refreshToken)
      if (refreshed) {
        isAuthenticated = (await verifyAccessToken(refreshed.access_token)) !== null
      }
    }
  }

  return <LandingPage isAuthenticated={isAuthenticated} />
}
