/* Service Worker — cache do app para funcionar offline.
   Estratégia: network-first (online sempre pega a versão nova; cache é
   só fallback offline). Isso evita o app ficar "preso" numa versão antiga. */
const CACHE = 'despesas-soma-v33';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './js/core.js',
  './js/render.js',
  './js/modal.js',
  './js/excel.js',
  './js/pdf.js',
  './js/sync.js',
  './js/lock.js',
  './js/ui.js',
  './js/ocr.js',
  './js/idb.js',
  './js/drive-core.js',
  './js/drive-scan.js',
  './js/main.js',
  './lib/fflate.min.js',
  './lib/html2canvas.min.js',
  './lib/jspdf.umd.min.js',
  './template.xlsx',
  './template-santander.xlsx',
  './assets/soma-logo.png',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    // {cache:'reload'} força baixar da REDE, ignorando o cache HTTP do navegador.
    // Sem isso, o GitHub Pages serve assets com max-age=600 e o precache poderia
    // gravar a versão ANTIGA do app.js, deixando o PWA preso numa versão velha.
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
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
    // Network-first DE VERDADE: {cache:'no-cache'} obriga revalidar com o servidor
    // a cada carga (ignora o max-age=600 do cache HTTP). Se nada mudou, o GitHub Pages
    // responde 304 via ETag — leve. Se conseguir, atualiza o cache e devolve a versão
    // fresca; se falhar (offline), cai para o que estiver em cache.
    fetch(req, { cache: 'no-cache' })
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
