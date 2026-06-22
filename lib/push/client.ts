'use client'

export const PUSH_PERMISSION_KEY = 'push_permission_asked'
export const PUSH_DEFERRED_AT_KEY = 'push_permission_deferred_at'
const DEFER_DAYS = 7

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
    return await navigator.serviceWorker.register('/sw.js')
  } catch (err) {
    console.error('[push] service worker registration failed:', err)
    return null
  }
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.ready.catch(() => null)
  if (!registration) return null
  return registration.pushManager.getSubscription()
}

export async function subscribeToPush(): Promise<PushSubscription | null> {
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!vapidKey) {
    console.error('[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set')
    return null
  }

  const registration = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready.catch(() => null))
  if (!registration) return null

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
  })

  try {
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        p256dh: arrayBufferToBase64(subscription.getKey('p256dh')),
        auth: arrayBufferToBase64(subscription.getKey('auth')),
        userAgent: navigator.userAgent,
      }),
    })
  } catch (err) {
    console.error('[push] subscribe API failed:', err)
  }

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
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        p256dh: arrayBufferToBase64(subscription.getKey('p256dh')),
        auth: arrayBufferToBase64(subscription.getKey('auth')),
        userAgent: navigator.userAgent,
      }),
    })
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
