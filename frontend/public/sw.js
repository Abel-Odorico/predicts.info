const ICON = '/icon-192.png'
const BADGE = '/favicon-32x32.png'

self.addEventListener('install', e => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(clients.claim()))

self.addEventListener('push', e => {
  const data = e.data?.json() || {}
  e.waitUntil(
    self.registration.showNotification(data.title || 'Predicts', {
      body: data.body || '',
      icon: ICON,
      badge: BADGE,
      data: { url: data.url || '/dashboard' },
      vibrate: [100, 50, 100],
    })
  )
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const url = e.notification.data?.url || '/dashboard'
      const existing = list.find(c => c.url.includes(self.registration.scope) && 'focus' in c)
      if (existing) return existing.navigate(url).then(c => c.focus())
      return clients.openWindow(url)
    })
  )
})
