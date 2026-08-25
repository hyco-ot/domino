/* Service worker: la app abre al instante y funciona sin internet.

   VERSION sube a mano, +1 por cada cambio suelto (tres cambios de una tacada,
   +3). Ese cambio de bytes es LO ÚNICO que hace que el navegador vea este
   archivo como nuevo y se baje la versión siguiente: si sw.js no cambia, el
   teléfono no se entera nunca por mucho que cambie index.html.

   O sea que SUBIRLA NO ES OPCIONAL. Publicar sin tocarla equivale a no publicar.
   Sale a la vista en Ajustes, así que se comprueba desde el propio teléfono.

   El SW nuevo NO entra solo: se instala y se queda esperando hasta que la app
   le manda SKIP_WAITING, que es lo que dispara el botón "Actualizar". Así nunca
   se mezcla una página vieja ya cargada con archivos de la versión nueva. */

const VERSION = '2.66';               // +1 por cada cambio suelto
const CACHE   = `tranque-${VERSION}`; // caché propia por versión
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

/* addAll() habría valido, pero se sirve de la caché HTTP del navegador: con un
   index.html todavía fresco de la versión anterior, este worker se guardaría el
   HTML VIEJO en su propia caché y serviría una mezcla — el número de versión de
   uno y la pantalla del otro. Con cache:'reload' cada archivo viene de la red y
   de paso refresca la caché HTTP.

   Si alguno falla, no se guarda ninguno: la instalación entera se cae y el
   worker viejo sigue mandando, que es mejor que una copia a medias. */
self.addEventListener('install', e => {
  // A propósito sin skipWaiting: el SW nuevo espera a que el usuario acepte.
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(
    ASSETS.map(u => fetch(u, { cache: 'reload' }).then(r => {
      if (!r.ok) throw new Error('no se pudo bajar ' + u);
      return c.put(u, r);
    }))
  )));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (!e.data) return;
  // lo pide la app cuando el usuario toca "Actualizar"
  if (e.data.type === 'SKIP_WAITING') self.skipWaiting();
  // para poder ver en Ajustes qué versión está sirviendo de verdad
  if (e.data.type === 'GET_VERSION' && e.ports[0]) e.ports[0].postMessage(VERSION);
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
