// Master password → PBKDF2-SHA256 → AES-GCM 256. Key is non-extractable and lives only in memory.
const enc = new TextEncoder();
const dec = new TextDecoder();
export const PBKDF2_ITER = 600000;
const VERIFIER = 'keesnap-ok';

export const b64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function deriveKey(password, salt, iterations = PBKDF2_ITER) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptJSON(key, obj) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64(iv), ct: b64(ct) };
}

export async function decryptJSON(key, rec) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, key, unb64(rec.ct));
  return JSON.parse(dec.decode(pt));
}

export async function makeVerifier(key) {
  return encryptJSON(key, { v: VERIFIER });
}

export async function checkVerifier(key, rec) {
  try {
    const o = await decryptJSON(key, rec);
    return o.v === VERIFIER || o.v === 'photo-vault-ok';
  } catch {
    return false; // wrong password → GCM auth fails
  }
}
