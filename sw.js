/* Service worker: la app abre al instante y funciona sin internet.

   Cada despliegue trae su VERSION, y ese cambio de bytes es LO ÚNICO que hace
   que el navegador vea este archivo como nuevo y se baje la versión siguiente.
   Si sw.js no cambia, el teléfono no se entera nunca de que hay algo nuevo por
   mucho que cambie index.html. La estampa la GitHub Action al publicar.

   El SW nuevo NO entra solo: se instala y se queda esperando hasta que la app
   le manda SKIP_WAITING, que es lo que dispara el botón "Actualizar". Así nunca
   se mezcla una página vieja ya cargada con archivos de la versión nueva. */

const VERSION = '__BUILD__';          // lo reemplaza el despliegue
const CACHE   = `domino-${VERSION}`;  // caché propia por versión
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', e => {
  // A propósito sin skipWaiting: el SW nuevo espera a que el usuario acepte.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// la app lo pide cuando el usuario toca "Actualizar"
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* Caché primero. Como cada versión tiene su propia caché, todo lo que sirve un
   SW es de la misma versión: ya no hace falta refrescar por detrás, y así no se
   mezclan dos versiones dentro de una misma sesión. Lo nuevo entra solo cuando
   se activa el SW siguiente, que es cuando el usuario lo pide. */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
