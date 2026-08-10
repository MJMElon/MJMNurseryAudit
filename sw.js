/* ================================================================
   MJM NURSERY AUDIT — RETIRED

   The audit app now lives in the portal, at
   https://ai.mjmnursery.com/audit/. This repository no longer serves it.

   Phones that installed the old PWA registered the previous version of
   this file and cached the whole app, so they would keep opening the old
   audit offline forever and never see the redirect. This replacement
   worker exists only to take itself down: it drops every cache, stops
   answering fetches, unregisters, and reloads whatever is open so the
   next load comes from the network.
================================================================ */

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.registration.unregister(); })
      .then(function () { return self.clients.matchAll({ type: 'window' }); })
      .then(function (clients) {
        clients.forEach(function (c) { c.navigate(c.url); });
      })
      .catch(function () {})
  );
});

/* Answer nothing — every request goes straight to the network. */
