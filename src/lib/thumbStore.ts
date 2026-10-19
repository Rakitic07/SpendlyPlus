/*
 * Bill thumbnails (100–500KB of base64 each) are kept OUT of the localStorage
 * list cache. Packing them into that one JSON blob meant every list change
 * stringified megabytes on the main thread, and a handful of receipts blew the
 * ~5MB quota so the whole offline cache silently stopped saving.
 *
 * Instead: an in-memory map for the current session, persisted per expense id
 * in IndexedDB (async, large quota). Everything here is best-effort — if
 * IndexedDB is unavailable the previews simply fall back to the server fetch.
 */

const DB_NAME = "spendly-thumbs";
const STORE = "thumbs";

const mem = new Map<string, string>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function withStore(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => void
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    fn(db.transaction(STORE, mode).objectStore(STORE));
  } catch {
    /* quota / closed db — previews just won't persist */
  }
}

export function memThumb(id: string): string | undefined {
  return mem.get(id);
}

export function rememberThumb(id: string, dataUrl: string): void {
  if (mem.get(id) === dataUrl) return;
  mem.set(id, dataUrl);
  void withStore("readwrite", (s) => s.put(dataUrl, id));
}

export function forgetThumb(id: string): void {
  if (!mem.delete(id)) return;
  void withStore("readwrite", (s) => s.delete(id));
}

/** Load the given ids from IndexedDB into memory; returns the ones found. */
export async function loadThumbs(ids: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const missing: string[] = [];
  for (const id of ids) {
    const t = mem.get(id);
    if (t) found.set(id, t);
    else missing.push(id);
  }
  if (!missing.length) return found;
  const db = await openDb();
  if (!db) return found;
  await new Promise<void>((resolve) => {
    try {
      const store = db.transaction(STORE, "readonly").objectStore(STORE);
      let left = missing.length;
      for (const id of missing) {
        const req = store.get(id);
        req.onsuccess = () => {
          if (typeof req.result === "string") {
            mem.set(id, req.result);
            found.set(id, req.result);
          }
          if (--left === 0) resolve();
        };
        req.onerror = () => {
          if (--left === 0) resolve();
        };
      }
    } catch {
      resolve();
    }
  });
  return found;
}
