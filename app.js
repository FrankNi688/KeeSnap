import * as C from './crypto.js';
import * as DB from './db.js';
import { CATEGORIES, classify, labelOf, suggestTitle } from './classify.js';
import { t, lang, setLang, applyStatic } from './i18n.js';

const $ = (id) => document.getElementById(id);
const AUTO_LOCK_MS = 5 * 60 * 1000;

let key = null;          // memory only
let items = [];          // decrypted items, only while unlocked
let filter = 'all';
let pending = null;      // new item under review
let current = null;      // item on the detail screen
let ocrWorker = null;

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
  $('list').innerHTML = ''; $('dText').textContent = ''; $('dImg').removeAttribute('src');
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
  if (!file) return;
  const ocrImg = await resize(file, 2000, 0.92);
  const keepImg = await resize(file, 1280, 0.8);
  pending = { image: keepImg };
  $('reviewImg').src = keepImg;
  $('ocrText').value = ''; $('title').value = ''; $('saveBtn').disabled = true;
  show('review');
  $('ocrStatus').textContent = t('ocrRunning');
  const t0 = performance.now();
  try {
    const text = await ocr(ocrImg);
    const cat = classify(text);
    $('ocrText').value = text; $('category').value = cat; $('title').value = suggestTitle(text, cat);
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    const codey = ['recovery', 'wifi', 'security'].includes(cat);
    if (codey) $('keepImg').checked = true; // codes: always keep the photo for checking
    $('ocrStatus').textContent = t('ocrDone', { s: secs }) + t(codey ? 'ocrCheckCodes' : 'ocrCheck');
  } catch (err) {
    $('ocrStatus').textContent = t('ocrFail', { e: err.message });
  }
  $('saveBtn').disabled = false;
};
function fillCategories() {
  const sel = $('category'), v = sel.value; sel.innerHTML = '';
  for (const c of CATEGORIES) sel.append(new Option(labelOf(c.id), c.id));
  if (v) sel.value = v;
}
$('langSel').onchange = (e) => { setLang(e.target.value); fillCategories(); render(); storageInfo(); };
$('cancelBtn').onclick = () => { pending = null; show('main'); };

async function ocr(dataUrl) {
  if (!ocrWorker) {
    const base = new URL('vendor/', location.href).href;
    ocrWorker = await Tesseract.createWorker(['eng', 'chi_sim'], 1, {
      workerPath: base + 'tesseract/worker.min.js',
      corePath: base + 'tesseract/',
      langPath: base + 'lang',
      gzip: true,
      cacheMethod: 'none', // language data is cached by the Service Worker
    });
  }
  const { data } = await ocrWorker.recognize(dataUrl);
  return tidy(data.text);
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
    image: $('keepImg').checked ? pending.image : null,
    created: Date.now(),
  };
  const id = crypto.randomUUID();
  await DB.putItem({ id, ...(await C.encryptJSON(key, entry)) });
  items.unshift({ id, ...entry });
  pending = null; render(); show('main');
};

// ----------
function openDetail(i) {
  current = i;
  $('dTitle').textContent = i.title;
  $('dMeta').textContent = labelOf(i.category) + ' · ' + new Date(i.created).toLocaleString();
  $('dText').textContent = i.text;
  if (i.image) $('dImg').src = i.image; else $('dImg').removeAttribute('src');
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
