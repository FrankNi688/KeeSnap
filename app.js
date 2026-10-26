import * as C from './crypto.js';
import * as DB from './db.js';
import { CATEGORIES, classify, labelOf } from './classify.js';
import { safeTitle, selectAutoOcr } from './ocr-logic.js';
import { t, lang, setLang, applyStatic } from './i18n.js';

const $ = (id) => document.getElementById(id);
const AUTO_LOCK_MS = 5 * 60 * 1000;

let key = null;          // memory only
let items = [];          // decrypted items, only while unlocked
let filter = 'all';
let pending = null;      // new item under review
let current = null;      // item on the detail screen
const ocrWorkers = new Map();
let ocrSource = null;
let cropImageElement = null;
let cropSelection = null;
let imageQueue = [];
let queueIndex = 0;
let queueTotal = 0;
let albumSession = false;

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
  $('lockBtn').classList.toggle('hidden', !key);
}

// ---------- updates: a new sw.js installs in the background; offer a one-tap refresh
function setupUpdates() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller; // false on the very first install
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) $('updateBar').classList.remove('hidden');
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // also check when the app comes back from the background, not only on a cold start
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
}
$('updateBtn').onclick = () => location.reload();

// ----------
async function boot() {
  setupUpdates();
  applyStatic(); fillCategories(); $('langSel').value = lang;
  const meta = await DB.getMeta('vault');
  show(meta ? 'unlock' : 'setup');
}

// ----------
$('setupBtn').onclick = async () => {
  const a = $('pw1').value, b = $('pw2').value;
  if (a.length < 8) return ($('setupMsg').textContent = t('tooShort'));
  if (a !== b) return ($('setupMsg').textContent = t('mismatch'));
  $('setupBtn').disabled = true; $('setupMsg').textContent = '';
  const salt = C.randomBytes(16);
  key = await C.deriveKey(a, salt);
  await DB.setMeta('vault', { salt: C.b64(salt), iter: C.PBKDF2_ITER, verifier: await C.makeVerifier(key), created: Date.now() });
  $('pw1').value = $('pw2').value = '';
  await requestPersist();
  await enterMain();
};

$('unlockBtn').onclick = unlock;
$('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); }); // an on-handler returning false would block typing
async function unlock() {
  $('unlockBtn').disabled = true; $('unlockMsg').textContent = t('unlocking');
  const meta = await DB.getMeta('vault');
  const k = await C.deriveKey($('pw').value, C.unb64(meta.salt), meta.iter);
  $('unlockBtn').disabled = false;
  if (!(await C.checkVerifier(k, meta.verifier))) return ($('unlockMsg').textContent = t('wrongPw'));
  key = k; $('pw').value = ''; $('unlockMsg').textContent = '';
  await enterMain();
}

function lock() {
  key = null; items = []; pending = null; current = null;
  imageQueue = []; queueIndex = 0; queueTotal = 0; albumSession = false;
  $('list').innerHTML = ''; $('dText').textContent = ''; $('dImg').removeAttribute('src'); $('dCropImg').removeAttribute('src');
  show('unlock');
}
$('lockBtn').onclick = lock;

let idleTimer, hiddenAt = 0;
function resetIdle() { clearTimeout(idleTimer); if (key) idleTimer = setTimeout(lock, AUTO_LOCK_MS); }
['pointerdown', 'keydown', 'scroll'].forEach((e) => addEventListener(e, resetIdle, { passive: true }));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (key && Date.now() - hiddenAt > 60000) lock();   // lock if away > 1 min
});

async function enterMain() {
  const recs = await DB.allItems();
  items = [];
  for (const r of recs) items.push({ id: r.id, ...(await C.decryptJSON(key, r)) });
  items.sort((a, b) => b.created - a.created);
  render(); show('main'); resetIdle(); storageInfo();
}

// ----------
$('search').oninput = render;
function render() {
  const q = $('search').value.trim().toLowerCase();
  const chips = $('chips'); chips.innerHTML = '';
  const used = ['all', ...new Set(items.map((i) => i.category))];
  for (const c of used) {
    const b = document.createElement('button');
    b.textContent = c === 'all' ? t('all') : labelOf(c);
    b.className = c === filter ? 'on' : '';
    b.onclick = () => { filter = c; render(); };
    chips.append(b);
  }
  const list = $('list'); list.innerHTML = '';
  const shown = items.filter((i) => (filter === 'all' || i.category === filter) &&
    (!q || (i.title + '\n' + i.text + '\n' + labelOf(i.category)).toLowerCase().includes(q)));
  for (const i of shown) {
    const li = document.createElement('li');
    li.innerHTML = `<div class="c"></div><div class="t"></div><div class="hint"></div>`;
    li.querySelector('.c').textContent = labelOf(i.category);
    li.querySelector('.t').textContent = i.title;
    li.querySelector('.hint').textContent = new Date(i.created).toLocaleString();
    li.onclick = () => openDetail(i);
    list.append(li);
  }
  $('empty').classList.toggle('hidden', items.length > 0);
}

// ----------
$('photo').onchange = async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (file) startImageQueue([file], false);
};
$('albumBtn').onclick = () => $('albumFiles').click();
$('albumFiles').onchange = (e) => {
  const files = Array.from(e.target.files || []); e.target.value = '';
  if (files.length) startImageQueue(files, true);
};
$('rerunOcrBtn').onclick = () => runOcr();
$('cropAgainBtn').onclick = () => startCrop();
$('useCropBtn').onclick = () => recognizeSelection(false);
$('skipCropBtn').onclick = () => recognizeSelection(true);
$('skipImageCropBtn').onclick = () => finishQueueItem();
$('skipImageReviewBtn').onclick = () => finishQueueItem();

function startImageQueue(files, fromAlbum) {
  imageQueue = files; queueIndex = 0; queueTotal = files.length; albumSession = fromAlbum;
  loadQueuedImage();
}

async function loadQueuedImage() {
  if (queueIndex >= queueTotal) return finishImageQueue();
  const image = await resize(imageQueue[queueIndex], 2200, 0.92);
  pending = { image };
  updateQueueProgress();
  await startCrop();
}

function updateQueueProgress() {
  const visible = albumSession && queueTotal > 0;
  const text = visible ? t('albumProgress', { current: queueIndex + 1, total: queueTotal }) : '';
  for (const id of ['cropProgress', 'reviewProgress']) {
    $(id).textContent = text;
    $(id).classList.toggle('hidden', !visible);
  }
}

function finishQueueItem() {
  pending = null; ocrSource = null; cropImageElement = null;
  queueIndex++;
  if (queueIndex < queueTotal) return loadQueuedImage();
  finishImageQueue();
}

function finishImageQueue() {
  const remind = albumSession;
  imageQueue = []; queueIndex = 0; queueTotal = 0; albumSession = false;
  pending = null; ocrSource = null; cropImageElement = null;
  updateQueueProgress(); show('main');
  if (remind) alert(t('albumReminder'));
}

function cancelImageQueue() {
  imageQueue = []; queueIndex = 0; queueTotal = 0; albumSession = false;
  pending = null; ocrSource = null; cropImageElement = null;
  updateQueueProgress(); show('main');
}

async function startCrop() {
  if (!pending) return;
  cropImageElement = new Image();
  await new Promise((resolve, reject) => {
    cropImageElement.onload = resolve;
    cropImageElement.onerror = reject;
    cropImageElement.src = pending.image;
  });
  const canvas = $('cropCanvas');
  canvas.width = cropImageElement.naturalWidth; canvas.height = cropImageElement.naturalHeight;
  cropSelection = { x: 0, y: 0, w: canvas.width, h: canvas.height };
  drawCrop();
  show('crop');
  updateQueueProgress();
}

function drawCrop() {
  if (!cropImageElement || !cropSelection) return;
  const canvas = $('cropCanvas'), ctx = canvas.getContext('2d');
  ctx.drawImage(cropImageElement, 0, 0, canvas.width, canvas.height);
  const s = cropSelection;
  ctx.fillStyle = 'rgba(0,0,0,.48)'; ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height); ctx.rect(s.x, s.y, s.w, s.h);
  ctx.fill('evenodd');
  ctx.strokeStyle = '#facc15'; ctx.lineWidth = Math.max(3, canvas.width / 500);
  ctx.strokeRect(s.x, s.y, s.w, s.h);
}

let cropDrag = null;
function canvasPoint(e) {
  const canvas = $('cropCanvas'), rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) * canvas.width / rect.width, y: (e.clientY - rect.top) * canvas.height / rect.height };
}
$('cropCanvas').addEventListener('pointerdown', (e) => {
  if (!cropImageElement) return;
  e.preventDefault(); $('cropCanvas').setPointerCapture(e.pointerId);
  cropDrag = canvasPoint(e); cropSelection = { x: cropDrag.x, y: cropDrag.y, w: 0, h: 0 };
});
$('cropCanvas').addEventListener('pointermove', (e) => {
  if (!cropDrag) return;
  const p = canvasPoint(e);
  cropSelection = { x: Math.min(cropDrag.x, p.x), y: Math.min(cropDrag.y, p.y), w: Math.abs(p.x - cropDrag.x), h: Math.abs(p.y - cropDrag.y) };
  drawCrop();
});
for (const eventName of ['pointerup', 'pointercancel']) $('cropCanvas').addEventListener(eventName, () => {
  if (!cropDrag) return;
  cropDrag = null;
  if (cropSelection.w < 8 || cropSelection.h < 8) cropSelection = { x: 0, y: 0, w: $('cropCanvas').width, h: $('cropCanvas').height };
  drawCrop();
});

async function recognizeSelection(skip) {
  if (!pending || !cropImageElement) return;
  const canvas = $('cropCanvas');
  const s = skip ? { x: 0, y: 0, w: canvas.width, h: canvas.height } : cropSelection;
  const output = document.createElement('canvas');
  output.width = Math.max(1, Math.round(s.w)); output.height = Math.max(1, Math.round(s.h));
  output.getContext('2d').drawImage(cropImageElement, s.x, s.y, s.w, s.h, 0, 0, output.width, output.height);
  pending.cropImage = output.toDataURL('image/jpeg', 0.94);
  ocrSource = pending.cropImage;
  $('reviewImg').src = pending.image;
  $('ocrText').value = ''; $('title').value = ''; $('saveBtn').disabled = true;
  $('ocrMode').value = 'auto';
  show('review');
  updateQueueProgress();
  await runOcr();
}
function fillCategories() {
  const sel = $('category'), v = sel.value; sel.innerHTML = '';
  for (const c of CATEGORIES) sel.append(new Option(labelOf(c.id), c.id));
  if (v) sel.value = v;
}
$('langSel').onchange = (e) => { setLang(e.target.value); fillCategories(); render(); storageInfo(); };
$('cancelBtn').onclick = cancelImageQueue;

async function getOcrWorker(language, codeMode = false) {
  const workerKey = codeMode ? `${language}:code` : language;
  if (!ocrWorkers.has(workerKey)) {
    const base = new URL('vendor/', location.href).href;
    const worker = await Tesseract.createWorker(language.split('+'), 1, {
      workerPath: base + 'tesseract/worker.min.js',
      corePath: base + 'tesseract/',
      langPath: base + 'lang',
      gzip: true,
      cacheMethod: 'none', // language data is cached by the Service Worker
    });
    if (codeMode) await worker.setParameters(codeOcrParameters);
    ocrWorkers.set(workerKey, worker);
  }
  return ocrWorkers.get(workerKey);
}

const codeOcrParameters = {
  tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-',
  tessedit_pageseg_mode: '6',
};

async function ocr(dataUrl, language, codeMode = false) {
  const worker = await getOcrWorker(language, codeMode);
  if (codeMode) await worker.setParameters(codeOcrParameters);
  const imageForOcr = codeMode ? await preprocessCodes(dataUrl) : dataUrl;
  // recognize() is always called with the current crop; there is no OCR-result cache.
  const { data } = await worker.recognize(imageForOcr);
  return { text: codeMode ? data.text.replace(/[^A-Za-z0-9\-\r\n]/g, '').trim() : tidy(data.text), confidence: data.confidence };
}

async function runOcr() {
  if (!ocrSource || !pending) return;
  $('rerunOcrBtn').disabled = true; $('saveBtn').disabled = true;
  let mode = $('ocrMode').value;
  $('ocrStatus').textContent = t(mode === 'code' ? 'ocrCodeRunning' : 'ocrRunning');
  $('ocrText').value = ''; $('title').value = '';
  const t0 = performance.now();
  let usedCode = mode === 'code';
  try {
    let text;
    if (mode === 'auto') {
      const firstPass = await ocr(ocrSource, 'eng+chi_sim');
      const result = await selectAutoOcr(firstPass, classify(firstPass.text), async () => {
        $('ocrStatus').textContent = t('ocrCodeRunning');
        return ocr(ocrSource, 'eng', true);
      });
      text = result.text; usedCode = result.usedCode;
    } else if (mode === 'code') text = (await ocr(ocrSource, 'eng', true)).text;
    else text = (await ocr(ocrSource, mode)).text;

    const cat = classify(text);
    $('ocrText').value = text; $('category').value = cat;
    $('title').value = safeTitle(text, cat, labelOf(cat), new Date().toLocaleDateString());
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    const codey = ['recovery', 'wifi', 'security'].includes(cat);
    $('ocrStatus').textContent = (usedCode ? t('ocrCodeDone', { s: secs }) : t('ocrDone', { s: secs })) + t(codey ? 'ocrCheckCodes' : 'ocrCheck');
  } catch (err) {
    $('ocrStatus').textContent = t('ocrFail', { e: err.message });
  }
  $('rerunOcrBtn').disabled = false; $('saveBtn').disabled = false;
}

async function preprocessCodes(dataUrl) {
  const img = new Image();
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = dataUrl; });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth * 2; canvas.height = img.naturalHeight * 2;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.filter = 'blur(0.5px)'; ctx.drawImage(img, 0, 0, canvas.width, canvas.height); ctx.filter = 'none';
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let lo = 255, hi = 0;
  for (let i = 0; i < pixels.data.length; i += 4) {
    const gray = Math.round(0.299 * pixels.data[i] + 0.587 * pixels.data[i + 1] + 0.114 * pixels.data[i + 2]);
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = gray;
    lo = Math.min(lo, gray); hi = Math.max(hi, gray);
  }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const contrast = Math.max(0, Math.min(255, Math.round((pixels.data[i] - lo) * 255 / range)));
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = contrast;
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png');
}

// Tesseract puts spaces between Chinese characters; remove them (not newlines)
function tidy(t) {
  return t.replace(/([\u4e00-\u9fff，。：；？！（）])[ \t]+(?=[\u4e00-\u9fff，。：；？！（）])/g, '$1').replace(/\n{2,}/g, '\n').trim();
}

function resize(file, max, q) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(img.src);
      res(cv.toDataURL('image/jpeg', q));
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}

$('saveBtn').onclick = async () => {
  const entry = {
    title: $('title').value.trim() || labelOf($('category').value),
    category: $('category').value,
    text: $('ocrText').value,
    image: pending.image,
    cropImage: pending.cropImage,
    created: Date.now(),
  };
  const id = crypto.randomUUID();
  await DB.putItem({ id, ...(await C.encryptJSON(key, entry)) });
  items.unshift({ id, ...entry });
  render(); await finishQueueItem();
};

// ----------
function openDetail(i) {
  current = i;
  $('dTitle').textContent = i.title;
  $('dMeta').textContent = labelOf(i.category) + ' · ' + new Date(i.created).toLocaleString();
  $('dText').textContent = i.text;
  if (i.image) $('dImg').src = i.image; else $('dImg').removeAttribute('src');
  $('dOriginalLabel').classList.toggle('hidden', !i.image);
  if (i.cropImage) $('dCropImg').src = i.cropImage; else $('dCropImg').removeAttribute('src');
  $('dCropLabel').classList.toggle('hidden', !i.cropImage);
  show('detail');
}
$('backBtn').onclick = () => { current = null; show('main'); };
$('copyBtn').onclick = async () => {
  await navigator.clipboard.writeText(current.text);
  $('copyBtn').textContent = t('copied'); setTimeout(() => ($('copyBtn').textContent = t('copy')), 1500);
};
$('delBtn').onclick = async () => {
  if (!confirm(t('confirmDel'))) return;
  await DB.delItem(current.id);
  items = items.filter((x) => x.id !== current.id);
  render(); show('main');
};

// ----------
$('exportBtn').onclick = async () => {
  const meta = await DB.getMeta('vault');
  const backup = { app: 'keesnap', version: 1, exported: Date.now(), salt: meta.salt, iter: meta.iter, verifier: meta.verifier, items: await DB.allItems() };
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `keesnap-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};

$('importFile').onchange = async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  let b;
  try { b = JSON.parse(await file.text()); } catch { return alert(t('badFile')); }
  if (b.app !== 'keesnap' && b.app !== 'photo-vault') return alert(t('notOurs'));
  const meta = await DB.getMeta('vault');
  let bkKey = key;
  if (b.salt !== meta.salt) {
    const pw = prompt(t('otherVault'));
    if (pw == null) return;
    bkKey = await C.deriveKey(pw, C.unb64(b.salt), b.iter);
    if (!(await C.checkVerifier(bkKey, b.verifier))) return alert(t('badBackupPw'));
  }
  const have = new Set(items.map((i) => i.id));
  let n = 0;
  for (const r of b.items) {
    if (have.has(r.id)) continue;
    const entry = await C.decryptJSON(bkKey, r);
    await DB.putItem({ id: r.id, ...(await C.encryptJSON(key, entry)) }); // re-encrypt with the current key
    items.push({ id: r.id, ...entry }); n++;
  }
  items.sort((x, y) => y.created - x.created);
  render();
  alert(t('imported', { n }));
};

// ----------
async function requestPersist() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch {}
}
async function storageInfo() {
  if (!navigator.storage?.estimate) return;
  const p = navigator.storage.persisted ? await navigator.storage.persisted() : false;
  const { usage } = await navigator.storage.estimate();
  $('storageInfo').textContent = t('storage', { mb: (usage / 1048576).toFixed(1), p: t(p ? 'persisted' : 'notPersisted') });
}

boot();
