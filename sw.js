/* ================================================================
   MJM NURSERY AUDIT — SERVICE WORKER v3
   sw.js — Full PWA offline support
================================================================ */
const CACHE = 'mjm-audit-v8';

const FILES = [
  './',
  './index.html',
  './home.html',
  './plot_audit.html',
  './styles.css',
  './script.js',
  './height_index.html',
  './height_styles.css',
  './height_script.js',
  './papan_index.html',
  './papan_styles.css',
  './papan_script.js',
  './maintenance_index.html',
  './maintenance_styles.css',
  './maintenance_script.js',
  './report.html',
  './supabase.js',
  './dexie_offline.js',
  './lang.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://unpkg.com/dexie@3.2.4/dist/dexie.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap'
];

/* INSTALL */
self.addEventListener('install', e => {
  console.log('[SW] Installing v3...');
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.allSettled(FILES.map(url =>
        cache.add(url).catch(err => console.warn('[SW] Cache miss:', url, err.message))
      ))
    ).then(() => {
      console.log('[SW] Installed');
      return self.skipWaiting();
    })
  );
});

/* ACTIVATE */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => {
      console.log('[SW] Activated v3');
      return self.clients.claim();
    })
  );
});

/* FETCH */
self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET') return;
  const url = e.request.url;
  if(!url.startsWith('http')) return;

  // Supabase storage (photos) — cache-first so they show offline
  if(url.includes('supabase.co') && url.includes('/storage/')){
    e.respondWith(
      caches.match(e.request).then(cached => {
        if(cached) return cached;
        return fetch(e.request).then(res => {
          if(res && res.status === 200){
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Supabase REST API — network only, no cache
  if(url.includes('supabase.co')){
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({error:'offline'}), {
          headers: {'Content-Type':'application/json'}
        })
      )
    );
    return;
  }

  // Everything else — cache first, then network
  e.respondWith(
    caches.match(e.request, {ignoreSearch: true}).then(cached => {
      if(cached) return cached;
      return fetch(e.request).then(res => {
        if(res && res.status === 200 && res.type !== 'opaque'){
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        // Offline fallback for HTML pages
        if(e.request.headers.get('accept')?.includes('text/html')){
          return caches.match('./index.html', {ignoreSearch: true});
        }
        return new Response('Offline', {status: 503});
      });
    })
  );
});

/* MESSAGE */
self.addEventListener('message', e => {
  if(e.data === 'skipWaiting') self.skipWaiting();
});