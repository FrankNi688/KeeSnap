// IndexedDB: meta (salt, iterations, verifier) + items (each one ciphertext)
const DB_NAME = 'keesnap';
let dbp;

function open() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('meta');
        db.createObjectStore('items', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => res(out && 'result' in out ? out.result : out);
    t.onerror = () => rej(t.error);
  });
}

export const getMeta = (k) => tx('meta', 'readonly', (s) => s.get(k));
export const setMeta = (k, v) => tx('meta', 'readwrite', (s) => s.put(v, k));
export const allItems = () => tx('items', 'readonly', (s) => s.getAll());
export const putItem = (rec) => tx('items', 'readwrite', (s) => s.put(rec));
export const delItem = (id) => tx('items', 'readwrite', (s) => s.delete(id));
export const clearItems = () => tx('items', 'readwrite', (s) => s.clear());
