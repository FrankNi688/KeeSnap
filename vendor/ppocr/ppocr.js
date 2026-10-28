// Minimal PP-OCRv4 (det + English rec) for the browser, using onnxruntime-web.
// No OpenCV: axis-aligned boxes from connected components (fine for horizontal text).
// Expects global `ort` (onnxruntime-web). Runs on the page or inside a Web Worker (v12):
// on the page it draws on <canvas>, in a worker on OffscreenCanvas; the pixels are the same.

function makeCanvas(w, h) {
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return new OffscreenCanvas(w, h);
}

export async function createOcr({ detUrl, recUrl, dictUrl, wasmPaths, numThreads = 1 }) {
  if (wasmPaths) ort.env.wasm.wasmPaths = wasmPaths;
  ort.env.wasm.numThreads = Math.max(1, numThreads | 0);
  const [det, rec, dictText] = await Promise.all([
    ort.InferenceSession.create(detUrl, { executionProviders: ['wasm'] }),
    ort.InferenceSession.create(recUrl, { executionProviders: ['wasm'] }),
    fetch(dictUrl).then((r) => r.text()),
  ]);
  // index 0 = CTC blank, then dict lines, then space
  const chars = ['', ...dictText.split('\n').filter((c, i, a) => !(i === a.length - 1 && c === '')), ' '];
  return { recognize: (img, opts) => recognize(det, rec, chars, img, opts) };
}

function toCanvas(img, w, h, sx = 0, sy = 0, sw = img.width, sh = img.height) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

// RGBA -> float32 NCHW, BGR order, (x/255 - 0.5) / 0.5
function toTensor(rgba, w, h, padW = w) {
  const out = new Float32Array(3 * h * padW); // padding stays 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const o = y * padW + x;
    out[o] = rgba[i + 2] / 127.5 - 1;
    out[h * padW + o] = rgba[i + 1] / 127.5 - 1;
    out[2 * h * padW + o] = rgba[i] / 127.5 - 1;
  }
  return new ort.Tensor('float32', out, [1, 3, h, padW]);
}

async function detect(det, img) {
  // limit_side_len 736, type "min" (RapidOCR default); cap the long side at 2000
  let ratio = 1;
  const minSide = Math.min(img.width, img.height);
  if (minSide < 736) ratio = 736 / minSide;
  if (Math.max(img.width, img.height) * ratio > 2000) ratio = 2000 / Math.max(img.width, img.height);
  const w = Math.max(32, Math.round((img.width * ratio) / 32) * 32);
  const h = Math.max(32, Math.round((img.height * ratio) / 32) * 32);
  const t = toTensor(toCanvas(img, w, h), w, h);
  const res = await det.run({ [det.inputNames[0]]: t });
  const prob = res[det.outputNames[0]].data; // [1,1,h,w]
  const thresh = 0.3, boxThresh = 0.5, unclip = 1.6;
  const bmp = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) bmp[i] = prob[i] > thresh ? 1 : 0;
  // 2x2 dilation
  const dil = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    dil[i] = bmp[i] || (x > 0 && bmp[i - 1]) || (y > 0 && bmp[i - w]) || (x > 0 && y > 0 && bmp[i - w - 1]) ? 1 : 0;
  }
  // connected components (4-neighbour)
  const label = new Int32Array(w * h);
  const boxes = [];
  const stack = [];
  let n = 0;
  for (let s = 0; s < w * h; s++) {
    if (!dil[s] || label[s]) continue;
    n++; label[s] = n; stack.push(s);
    let sum = 0, cnt = 0, mx = 0, my = 0, sxx = 0, syy = 0, sxy = 0;
    const pts = [];
    while (stack.length) {
      const p = stack.pop(); const px = p % w, py = (p - px) / w;
      pts.push(px, py); sum += prob[p]; cnt++; mx += px; my += py;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h) continue;
        if ((q === p - 1 && px === 0) || (q === p + 1 && px === w - 1)) continue;
        if (dil[q] && !label[q]) { label[q] = n; stack.push(q); }
      }
    }
    if (cnt < 10 || sum / cnt < boxThresh) continue;
    mx /= cnt; my /= cnt;
    for (let k = 0; k < pts.length; k += 2) { const dx = pts[k] - mx, dy = pts[k + 1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy); // main axis angle
    const ca = Math.cos(ang), sa = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let k = 0; k < pts.length; k += 2) {
      const dx = pts[k] - mx, dy = pts[k + 1] - my;
      const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    let bw = u1 - u0 + 1, bh = v1 - v0 + 1;
    if (Math.min(bw, bh) < 3) continue;
    const d = (bw * bh * unclip) / (2 * (bw + bh));
    bw += 2 * d; bh += 2 * d;
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    const sxr = img.width / w, syr = img.height / h;
    boxes.push({
      cx: (mx + cu * ca - cv * sa) * sxr, cy: (my + cu * sa + cv * ca) * syr,
      w: bw * sxr, h: bh * syr, angle: ang,
    });
  }
  boxes.sort((a, b) => (Math.abs(a.cy - b.cy) < Math.min(a.h, b.h) / 2 ? a.cx - b.cx : a.cy - b.cy));
  return boxes;
}

async function recLine(rec, chars, img, b) {
  const H = 48;
  const W = Math.max(8, Math.min(2000, Math.ceil((H * b.w) / b.h)));
  const padW = Math.max(320, W);
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.scale(W / b.w, H / b.h);
  ctx.translate(b.w / 2, b.h / 2);
  ctx.rotate(-b.angle);
  ctx.drawImage(img, -b.cx, -b.cy);
  const t = toTensor(ctx.getImageData(0, 0, W, H).data, W, H, padW);
  const res = await rec.run({ [rec.inputNames[0]]: t });
  const out = res[rec.outputNames[0]];
  const [, T, C] = out.dims;
  let text = '', last = -1, confSum = 0, confN = 0;
  for (let i = 0; i < T; i++) {
    let best = 0, bv = -1;
    for (let c = 0; c < C; c++) { const v = out.data[i * C + c]; if (v > bv) { bv = v; best = c; } }
    if (best !== 0 && best !== last) { text += chars[best] ?? ''; confSum += bv; confN++; }
    last = best;
  }
  return { text: text.trim(), score: confN ? confSum / confN : 0 };
}

// Multi-read voting (v11): a single read flips look-alike characters (J/3, 3/S, x/X)
// depending on tiny scale or JPEG differences. Read each line several times from
// slightly different scales and box paddings, then vote character by character.
const VOTE_SCALES = [1, 0.9, 0.8, 0.7, 0.6];
const VOTE_PADS = [1];
function scaledSources(img) {
  return VOTE_SCALES.map((s) => {
    if (s === 1) return { s, src: img };
    const c = makeCanvas(Math.max(1, Math.round(img.width * s)), Math.max(1, Math.round(img.height * s)));
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, c.width, c.height);
    return { s, src: c };
  });
}
function vote(reads) {
  const ok = reads.filter((r) => r.text);
  if (!ok.length) return { text: '', score: 0, agree: 0, n: 0 };
  // most common length (weighted by score)
  const byLen = new Map();
  for (const r of ok) byLen.set(r.text.length, (byLen.get(r.text.length) || 0) + 1 + r.score / 10);
  const L = [...byLen.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const same = ok.filter((r) => r.text.length === L);
  let text = '', agree = 1;
  for (let i = 0; i < L; i++) {
    const tally = new Map();
    for (const r of same) tally.set(r.text[i], (tally.get(r.text[i]) || 0) + 1 + r.score / 10);
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    text += top[0][0];
    const cnt = same.filter((r) => r.text[i] === top[0][0]).length;
    agree = Math.min(agree, cnt / same.length);
  }
  const score = same.reduce((a, r) => a + r.score, 0) / same.length;
  return { text, score, agree, n: same.length };
}

async function recognize(det, rec, chars, img, opts = {}) {
  const progress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  progress({ phase: 'detect' });
  const boxes = await detect(det, img);
  const multi = opts.vote !== false;
  const skipAbove = typeof opts.skipVoteAbove === 'number' ? opts.skipVoteAbove : Infinity; // off unless set
  const sources = multi ? scaledSources(img) : [{ s: 1, src: img }];
  const pads = multi ? VOTE_PADS : [1];
  const lines = [];
  for (let li = 0; li < boxes.length; li++) {
    const b = boxes[li];
    progress({ phase: 'line', current: li + 1, total: boxes.length });
    const first = await recLine(rec, chars, img, b);
    // only vote on lines that look like codes (contain a dash) to keep it fast
    if (!multi || !/-/.test(first.text) || first.score >= skipAbove) {
      if (first.text && first.score >= 0.5) lines.push({ ...first, box: b, first: first.score });
      continue;
    }
    const reads = [first];
    for (const { s, src } of sources) for (const pd of pads) {
      if (s === 1 && pd === 1) continue;
      const bb = { cx: b.cx * s, cy: b.cy * s, w: b.w * s * pd, h: b.h * s * (1 + (pd - 1) * 1.5), angle: b.angle };
      reads.push(await recLine(rec, chars, src, bb));
    }
    const v = vote(reads);
    if (v.text && v.score >= 0.5) lines.push({ text: v.text, score: v.score, agree: v.agree, reads: reads.map((r) => r.text), first: first.score, firstText: first.text, box: b });
  }
  return lines;
}
