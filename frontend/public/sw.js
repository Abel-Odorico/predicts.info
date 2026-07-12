const CACHE = 'predicts-v93'
const ICON  = '/icon-192.png'
const BADGE = '/favicon-32x32.png'

const SHELL = [
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.ico',
  '/favicon-32x32.png',
  '/favicon-16x16.png',
  '/manifest.json',
  '/apple-touch-icon.png',
]

// ── Lifecycle ─────────────────────────────────────────────────────────────

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' })
        .then(all => all.forEach(c => c.postMessage({ type: 'SW_ACTIVATED', cache: CACHE })))
      )
  )
})

// ── Fetch strategies ──────────────────────────────────────────────────────

self.addEventListener('fetch', e => {
  const { request } = e
  const url = new URL(request.url)

  // Only handle GET + same-origin (skip ads, fonts, analytics)
  if (request.method !== 'GET') return
  if (url.origin !== self.location.origin) return

  // API: network-first → stale cache fallback
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(networkFirst(request))
    return
  }

  // Vite hashed assets (/assets/): cache-first (content-hashed filenames, safe forever)
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(cacheFirst(request))
    return
  }

  // HTML navigation + index: network-first, offline falls back to cached index
  if (request.mode === 'navigate' || url.pathname === '/') {
    e.respondWith(
      fetch(request)
        .then(res => {
          caches.open(CACHE).then(c => c.put(request, res.clone()))
          return res
        })
        .catch(async () => {
          const cached = await caches.match(request)
            || await caches.match('/')
            || await caches.match('/index.html')
          return cached || new Response('Offline', { status: 503 })
        })
    )
    return
  }

  // Static files (icons, manifests, etc): cache-first
  e.respondWith(cacheFirst(request))
})

async function networkFirst(req) {
  try {
    const res = await fetch(req)
    // só cacheia respostas ok (2xx) — erros 4xx/5xx não devem ser servidos offline
    if (res.ok) {
      const cache = await caches.open(CACHE)
      cache.put(req, res.clone())
    }
    return res
  } catch {
    const cached = await caches.match(req)
    return cached || new Response(
      JSON.stringify({ error: 'offline' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req)
  if (cached) return cached
  try {
    const res = await fetch(req)
    const cache = await caches.open(CACHE)
    cache.put(req, res.clone())
    return res
  } catch {
    return new Response('Not available offline', { status: 503 })
  }
}

// ── Push notifications ────────────────────────────────────────────────────

self.addEventListener('push', e => {
  const data = e.data?.json() || {}
  e.waitUntil(
    self.registration.showNotification(data.title || 'Predicts', {
      body: data.body || '',
      icon: ICON,
      badge: BADGE,
      tag: data.tag || 'predicts-push',
      renotify: true,
      requireInteraction: false,
      data: { url: data.url || '/' },
      vibrate: [200, 100, 200],
      actions: data.url ? [{ action: 'open', title: 'Abrir' }] : [],
    })
  )
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = e.notification.data?.url || '/'
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.focus)
      if (existing) return existing.navigate(url).then(c => c.focus())
      return clients.openWindow(url)
    })
  )
})
