/* ================================================================
   MJM NURSERY AUDIT — SERVICE WORKER
   sw.js — caches app for offline use
================================================================ */
const CACHE = 'mjm-audit-v1';
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
  './supabase.js',
  './offline.js',
  'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap'
];

// Install — cache all files
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — serve from cache, fallback to network
self.addEventListener('fetch', e => {
  // Always go network-first for Supabase API calls
  if (e.request.url.includes('supabase.co')) {
    e.respondWith(
      fetch(e.request).catch(() => new Response(JSON.stringify({error:'offline'}), {
        headers: {'Content-Type':'application/json'}
      }))
    );
    return;
  }
  // Cache-first for app files
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(cache => cache.put(e.request, clone));
      return res;
    }))
  );
});