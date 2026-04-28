/* ================================================================
   MJM NURSERY AUDIT — SERVICE WORKER v6
   Strategy: Network first for HTML, cache first for assets
================================================================ */
const CACHE = 'mjm-v6';

const STATIC = [
  './dexie.min.js',
  './dexie_offline.js',
  './lang.js',
  './supabase.js',
  './styles.css',
  './height_styles.css',
  './papan_styles.css',
  './maintenance_styles.css',
  './script.js',
  './height_script.js',
  './papan_script.js',
  './maintenance_script.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

/* INSTALL — only cache static assets */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(
        STATIC.map(url => cache.add(url).catch(err => console.warn('[SW] Skip:', url)))
      ))
      .then(() => self.skipWaiting())
  );
});

/* ACTIVATE — delete old caches */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* FETCH */
self.addEventListener('fetch', e => {
  const url = e.request.url;
  if(e.request.method !== 'GET') return;

  // Supabase API — always network, never cache
  if(url.includes('supabase.co')){
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({error:'offline'}),
          {headers:{'Content-Type':'application/json'}})
      )
    );
    return;
  }

  // HTML pages — network first, fall back to cache
  if(e.request.headers.get('accept')?.includes('text/html') || url.endsWith('.html')){
    e.respondWith(
      fetch(e.request)
        .then(res => {
          // Cache the fresh version
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Static assets (JS/CSS/images) — cache first, then network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if(cached) return cached;
      return fetch(e.request).then(res => {
        if(res && res.status === 200){
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => new Response('Offline', {status:503}));
    })
  );
});

/* Force update on message */
self.addEventListener('message', e => {
  if(e.data === 'skipWaiting') self.skipWaiting();
});