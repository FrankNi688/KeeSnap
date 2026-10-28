// KeeSnap v12: English/code OCR (PP-OCRv4 det + rec + multi-read voting) in a Web Worker,
// so the page stays responsive. Same models, preprocessing and voting as v11 (vendor/ppocr/ppocr.js).
// Fully local: every file comes from this site (and the Service Worker cache). No network calls to anyone else.
importScripts('vendor/ppocr/ort.min.js');

let enginePromise = null;
let info = null;

function threadCount() {
  // Multi-threaded WASM needs SharedArrayBuffer, which needs crossOriginIsolated (sw.js adds the headers).
  if (!self.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') return 1;
  return Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1));
}

function getEngine() {
  if (!enginePromise) {
    if (typeof OffscreenCanvas === 'undefined' || !new OffscreenCanvas(1, 1).getContext('2d')) {
      return Promise.reject(new Error('no-offscreen-canvas'));
    }
    const base = new URL('./', self.location.href).href;
    const numThreads = threadCount();
    info = { path: 'worker', threads: numThreads, isolated: !!self.crossOriginIsolated };
    enginePromise = import('./vendor/ppocr/ppocr.js').then(({ createOcr }) => createOcr({
      detUrl: base + 'vendor/ppocr/ch_PP-OCRv4_det_mobile.onnx',
      recUrl: base + 'vendor/ppocr/en_PP-OCRv4_rec_mobile.onnx',
      dictUrl: base + 'vendor/ppocr/en_dict.txt',
      wasmPaths: base + 'vendor/ppocr/',
      numThreads,
    }));
    enginePromise.catch(() => { enginePromise = null; });
  }
  return enginePromise;
}

self.onmessage = async (e) => {
  const { id, type } = e.data || {};
  try {
    const engine = await getEngine();
    if (type === 'init') return self.postMessage({ id, type: 'ready', info });
    if (type === 'recognize') {
      const { bitmap, opts } = e.data;
      const lines = await engine.recognize(bitmap, {
        ...(opts || {}),
        onProgress: (p) => self.postMessage({ id, type: 'progress', ...p }),
      });
      if (bitmap && bitmap.close) bitmap.close();
      return self.postMessage({ id, type: 'result', lines, info });
    }
    throw new Error('unknown message ' + type);
  } catch (err) {
    self.postMessage({ id, type: 'error', message: (err && err.message) || String(err) });
  }
};
