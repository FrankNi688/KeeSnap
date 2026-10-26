KeeSnap local English OCR (PaddleOCR PP-OCRv4, runs in the browser, nothing uploaded)

Files
- ppocr.js                      minimal pipeline: detection + English recognition (createOcr / recognize)
- ch_PP-OCRv4_det_mobile.onnx   text detection model (PaddleOCR, Apache-2.0, ONNX from RapidOCR)
- en_PP-OCRv4_rec_mobile.onnx   English recognition model (PaddleOCR, Apache-2.0, ONNX from RapidOCR)
- en_dict.txt                   character list for the English model
- ort.min.js, ort-wasm-simd-threaded.wasm, ort-wasm-simd-threaded.mjs   onnxruntime-web 1.20.1 (MIT)

Usage
  <script src="vendor/ppocr/ort.min.js"></script>
  import { createOcr } from './vendor/ppocr/ppocr.js';
  const ocr = await createOcr({ detUrl: 'vendor/ppocr/ch_PP-OCRv4_det_mobile.onnx', recUrl: 'vendor/ppocr/en_PP-OCRv4_rec_mobile.onnx', dictUrl: 'vendor/ppocr/en_dict.txt', wasmPaths: 'vendor/ppocr/' });
  const lines = await ocr.recognize(imgElement);   // [{ text, score, box }]

Test results (Hark VM, headless Chromium, whole photo, no crop)
- Real 5-code screen photo: 5/5 exact, 2.9 s (model load 1.0 s)
- Fake sample 01: 5/5 codes exact (incl. M9LU), 1.6 s
