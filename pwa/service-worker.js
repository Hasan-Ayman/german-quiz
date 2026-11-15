const shellRoot = new URL(self.registration.scope)
const shellUrls = new Set(shellFiles.map(file => new URL(file, shellRoot).href))
const shellIndex = new URL('index.html', shellRoot).href

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // The first published shell could only import v1 files.
    const upgradesV1Importer = await caches.has(cachePrefix + '5d29cf465bf044c1')
    const cache = await caches.open(shellCache)
    await cache.addAll([...shellUrls].map(url => new Request(url, { cache: 'reload' })))
    if (upgradesV1Importer) await self.skipWaiting()
  })())
})

self.addEventListener('message', event => {
  if (event.data === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(key => key.startsWith(cachePrefix) && key !== shellCache)
      .map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  const isHome = event.request.mode === 'navigate' && url.origin === shellRoot.origin &&
    (url.pathname === shellRoot.pathname || url.pathname === shellRoot.pathname + 'index.html')
  if (!isHome && !shellUrls.has(url.href)) return
  const cacheKey = isHome ? shellIndex : url.href
  event.respondWith(caches.open(shellCache).then(async cache =>
    (await cache.match(cacheKey)) ?? fetch(event.request)))
})
