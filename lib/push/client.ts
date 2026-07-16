'use client'

export const PUSH_PERMISSION_KEY = 'push_permission_asked'
export const PUSH_DEFERRED_AT_KEY = 'push_permission_deferred_at'
const DEFER_DAYS = 7
const SW_READY_TIMEOUT_MS = 8_000

export type PushPermissionState = 'default' | 'granted' | 'denied'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
  if (!buffer) return ''
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return window.btoa(binary)
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    promise.then(
      value => {
        window.clearTimeout(timer)
        resolve(value)
      },
      err => {
        window.clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function shouldShowAutoPrompt(): boolean {
  if (!isPushSupported()) return false
  try {
    const asked = localStorage.getItem(PUSH_PERMISSION_KEY)
    if (!asked) return true
    if (asked === 'deferred') {
      const deferredAt = localStorage.getItem(PUSH_DEFERRED_AT_KEY)
      if (!deferredAt) return true
      const elapsed = Date.now() - new Date(deferredAt).getTime()
      return elapsed >= DEFER_DAYS * 24 * 60 * 60 * 1000
    }
    return false
  } catch {
    return false
  }
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    const registration = await navigator.serviceWorker.register('/sw.js')
    // Ensure an active worker before pushManager.subscribe — otherwise Chrome can hang
    // or fail silently when permission was already granted in a previous session.
    if (registration.installing) {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          const worker = registration.installing
          if (!worker) {
            resolve()
            return
          }
          worker.addEventListener('statechange', () => {
            if (worker.state === 'activated' || worker.state === 'installed') resolve()
            if (worker.state === 'redundant') reject(new Error('Service worker install failed'))
          })
        }),
        SW_READY_TIMEOUT_MS,
        'Service worker install',
      )
    }
    await withTimeout(
      navigator.serviceWorker.ready,
      SW_READY_TIMEOUT_MS,
      'Service worker ready',
    ).catch(() => registration)
    return registration
  } catch (err) {
    console.error('[push] service worker registration failed:', err)
    return null
  }
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
  try {
    const registration =
      (await navigator.serviceWorker.getRegistration()) ??
      (await withTimeout(navigator.serviceWorker.ready, SW_READY_TIMEOUT_MS, 'Service worker ready').catch(() => null))
    if (!registration) return null
    return registration.pushManager.getSubscription()
  } catch {
    return null
  }
}

async function persistSubscription(subscription: PushSubscription): Promise<void> {
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      p256dh: arrayBufferToBase64(subscription.getKey('p256dh')),
      auth: arrayBufferToBase64(subscription.getKey('auth')),
      userAgent: navigator.userAgent,
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? 'Could not save notification subscription')
  }
}

export async function subscribeToPush(): Promise<PushSubscription> {
  if (!isPushSupported()) {
    throw new Error('Push notifications are not supported in this browser')
  }

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!vapidKey) {
    throw new Error('Push is not configured on this server (missing VAPID public key)')
  }

  if (Notification.permission === 'denied') {
    throw new Error('Notifications are blocked in your browser settings')
  }

  if (Notification.permission !== 'granted') {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      throw new Error('Notification permission was not granted')
    }
  }

  const registration = await registerServiceWorker()
  if (!registration) {
    throw new Error('Could not register the notification service worker')
  }

  let subscription = await registration.pushManager.getSubscription()
  if (subscription) {
    // Existing browser subscription (permission was granted earlier) — just re-sync to server.
    try {
      await persistSubscription(subscription)
      return subscription
    } catch (err) {
      // Stale/invalid subscription — drop and create a fresh one.
      console.warn('[push] existing subscription sync failed, resubscribing:', err)
      try {
        await subscription.unsubscribe()
      } catch {
        /* ignore */
      }
      subscription = null
    }
  }

  try {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
    })
  } catch (err) {
    console.error('[push] pushManager.subscribe failed:', err)
    throw new Error(err instanceof Error ? err.message : 'Could not subscribe to push')
  }

  await persistSubscription(subscription)
  return subscription
}

export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await getPushSubscription()
  if (!subscription) return

  try {
    await fetch('/api/push/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    })
  } catch (err) {
    console.error('[push] unsubscribe API failed:', err)
  }

  await subscription.unsubscribe()
}

/** Re-sync an existing browser subscription to the server (e.g. after DB save failed). */
export async function syncExistingSubscription(): Promise<void> {
  if (Notification.permission !== 'granted') return
  const subscription = await getPushSubscription()
  if (!subscription) return

  try {
    await persistSubscription(subscription)
  } catch {
    /* silent */
  }
}

export function markPermissionDeferred() {
  try {
    localStorage.setItem(PUSH_PERMISSION_KEY, 'deferred')
    localStorage.setItem(PUSH_DEFERRED_AT_KEY, new Date().toISOString())
  } catch {
    /* ignore */
  }
}

export function markPermissionDenied() {
  try {
    localStorage.setItem(PUSH_PERMISSION_KEY, 'denied')
  } catch {
    /* ignore */
  }
}

export function markPermissionGranted() {
  try {
    localStorage.setItem(PUSH_PERMISSION_KEY, 'granted')
  } catch {
    /* ignore */
  }
}
