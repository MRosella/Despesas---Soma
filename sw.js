/* Service Worker — cache do app para funcionar offline.
   Estratégia: network-first (online sempre pega a versão nova; cache é
   só fallback offline). Isso evita o app ficar "preso" numa versão antiga. */
const CACHE = 'despesas-soma-v18';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './lib/fflate.min.js',
  './lib/html2canvas.min.js',
  './lib/jspdf.umd.min.js',
  './template.xlsx',
  './assets/soma-logo.png',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Só lida com requisições do mesmo domínio (deixa o resto passar direto)
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    // Network-first: tenta a rede; se conseguir, atualiza o cache e devolve a
    // versão fresca. Se falhar (offline), cai para o que estiver em cache.
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
