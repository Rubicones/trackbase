import webpush from 'web-push'
import { supabase } from '@/lib/supabase'
import { PUSH_ICON_URL } from '@/lib/push/constants'

let vapidInitialized = false

function ensureVapid() {
  if (vapidInitialized) return
  const email = process.env.VAPID_EMAIL
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!email || !publicKey || !privateKey) {
    throw new Error('VAPID environment variables are not configured')
  }
  webpush.setVapidDetails(email, publicKey, privateKey)
  vapidInitialized = true
}

export type PushPayload = {
  title: string
  body: string
  url: string
  icon?: string
}

export async function sendPushNotification(userId: string, payload: PushPayload) {
  try {
    ensureVapid()
  } catch (err) {
    console.error('[push] VAPID init failed:', err)
    return
  }

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)

  if (!subs?.length) return

  await Promise.allSettled(
    subs.map(sub =>
      webpush
        .sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify({ icon: PUSH_ICON_URL, ...payload }),
        )
        .catch(err => {
          if (err.statusCode === 410) {
            void supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
          } else {
            console.error('[push] send failed:', err.statusCode ?? err.message)
          }
        }),
    ),
  )
}
