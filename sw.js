// Service worker: la app corre entera en el navegador del cliente (render y lógica de juego); el servidor solo gestiona salas y retransmite estado.
// Los archivos estáticos se guardan en caché (abre al instante y el menú funciona sin conexión); se actualizan en segundo plano.
const V = 'ssp-v3'; // v2: models.js nuevo y ships.js/base.js/war.js cambiados a la vez (evita mezclar archivos viejos en caché con los nuevos)
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(V).then(c => c.addAll(['/', '/three.min.js', '/blobatar.js', '/menu.js', '/sysgen.js', '/icons/icon-192.png']))); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url); if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname === '/seed.js') return; // lo dinámico siempre va al servidor
  e.respondWith(caches.open(V).then(async c => { const hit = await c.match(e.request), net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit); return hit || net; }));
});
