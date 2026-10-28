// Offline: cache the app, the OCR engine and the English/Chinese language data.
// v12: also adds COOP/COEP headers to every response (the coi-serviceworker idea, merged into this one
// Service Worker). GitHub Pages can't send these headers itself; with them the page becomes
// crossOriginIsolated, which unlocks multi-threaded WASM for faster OCR. All files are same-origin.
const VERSION = 'ks-v12';
const ASSETS = [
  './', 'index.html', 'style.css', 'app.js', 'crypto.js', 'db.js', 'classify.js', 'ocr-logic.js', 'i18n.js', 'manifest.webmanifest',
  'ocr-worker.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/icon-180.png',
  'vendor/tesseract/tesseract.min.js', 'vendor/tesseract/worker.min.js',
  'vendor/tesseract/tesseract-core-simd-lstm.wasm.js', 'vendor/tesseract/tesseract-core-lstm.wasm.js',
  'vendor/lang/eng.traineddata.gz', 'vendor/lang/chi_sim.traineddata.gz',
  'vendor/ppocr/README.txt', 'vendor/ppocr/ppocr.js', 'vendor/ppocr/ort.min.js',
  'vendor/ppocr/ort-wasm-simd-threaded.wasm', 'vendor/ppocr/ort-wasm-simd-threaded.mjs',
  'vendor/ppocr/ch_PP-OCRv4_det_mobile.onnx', 'vendor/ppocr/en_PP-OCRv4_rec_mobile.onnx', 'vendor/ppocr/en_dict.txt',
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

function isolate(res) {
  if (!res || res.status === 0 || res.type === 'opaque' || res.type === 'opaqueredirect') return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;
  if (new URL(r.url).origin !== self.location.origin) return; // KeeSnap never loads anything from elsewhere
  e.respondWith(
    caches.match(r, { ignoreSearch: true }).then((hit) => hit || fetch(r)).then(isolate)
  );
});
