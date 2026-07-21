const CACHE = 'provision-lms-v3';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
  self.clients.matchAll().then(clients => {
    clients.forEach(c => c.postMessage({ type: 'UPDATED' }));
  });
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Never cache API calls - always fetch fresh data
  if (e.request.url.includes('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }
  // Never cache HTML - always get latest
  if (e.request.url.includes('.html') || e.request.url.endsWith('/')) {
    e.respondWith(fetch(e.request));
    return;
  }
  // Cache only static assets (CSS, JS, images)
  e.respondWith(
    fetch(e.request).then(r => {
      const clone = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return r;
    }).catch(() => caches.match(e.request))
  );
});
