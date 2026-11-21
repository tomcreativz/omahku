// Penyimpanan offline Omahku: salinan data ("snapshot") dan antrean perubahan ("outbox") di IndexedDB.
// Modul ini sengaja tidak mengimpor modul lain agar tidak membuat siklus impor.
const DB_NAME = "omahku-offline", STORE = "kv";

let dbp = null;
const open = () => dbp || (dbp = new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => { dbp = null; reject(req.error); };
}));

async function tx(mode, run) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

export const idbGet = (key) => tx("readonly", (s) => s.get(key));
export const idbSet = (key, value) => tx("readwrite", (s) => s.put(value, key));
export const idbDel = (key) => tx("readwrite", (s) => s.delete(key));

// Kegagalan jaringan: fetch() melempar TypeError ("Failed to fetch", "Load failed", "NetworkError…") tanpa kode HTTP.
// Jawaban dari server (401, 404, dst.) selalu punya kode HTTP, jadi BUKAN masalah jaringan.
export function isNetworkError(e) {
  if (!e) return false;
  if (typeof e.code === "number" && e.code >= 400) return false;
  const msg = typeof e === "string" ? e : String(e.message || "");
  return e.name === "TypeError" || /failed to fetch|networkerror|network request failed|load failed|internet connection/i.test(msg);
}

export const OFFLINE_MESSAGE = "Tidak ada koneksi internet. Fitur ini membutuhkan internet.";
