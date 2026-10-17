// Offline: cache the app, the OCR engine and the English/Chinese language data
const VERSION = 'ks-v5';
const ASSETS = [
  './', 'index.html', 'style.css', 'app.js', 'crypto.js', 'db.js', 'classify.js', 'i18n.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png',
  'vendor/tesseract/tesseract.min.js', 'vendor/tesseract/worker.min.js',
  'vendor/tesseract/tesseract-core-simd-lstm.wasm.js', 'vendor/tesseract/tesseract-core-lstm.wasm.js',
  'vendor/lang/eng.traineddata.gz', 'vendor/lang/chi_sim.traineddata.gz',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
  );
});
