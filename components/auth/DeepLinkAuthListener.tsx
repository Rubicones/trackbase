'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { handleAuthDeepLink } from '@/lib/auth/deep-link'

/** Listens for magic-link deep opens on native platforms. */
export function DeepLinkAuthListener() {
  const router = useRouter()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    let removed = false
    let listenerHandle: { remove: () => Promise<void> } | undefined

    async function onUrl(url: string) {
      await handleAuthDeepLink(url, router)
    }

    void App.addListener('appUrlOpen', event => {
      void onUrl(event.url)
    }).then(handle => {
      if (removed) {
        void handle.remove()
      } else {
        listenerHandle = handle
      }
    })

    void App.getLaunchUrl().then(result => {
      if (result?.url) {
        void onUrl(result.url)
      }
    })

    return () => {
      removed = true
      void listenerHandle?.remove()
    }
  }, [router])

  return null
}
