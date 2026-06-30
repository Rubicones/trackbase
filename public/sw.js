self.addEventListener('push', event => {
  let payload = { title: 'sonicdesk.', body: '', url: '/', icon: '/icon.svg' }
  try {
    if (event.data) payload = { ...payload, ...event.data.json() }
  } catch {
    /* use defaults */
  }

  const { title, body, url, icon } = payload

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: icon || '/icon.svg',
      badge: '/icon.svg',
      data: { url },
      tag: url,
      renotify: false,
    }),
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data?.url
  if (!url) return

  const targetUrl = new URL(url, self.location.origin).href

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        const clientPath = new URL(client.url).pathname + new URL(client.url).search
        if (clientPath === url || client.url.startsWith(new URL(url, self.location.origin).origin + new URL(url, self.location.origin).pathname)) {
          if ('focus' in client) return client.focus()
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl)
    }),
  )
})
