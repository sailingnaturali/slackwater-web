export interface ChsCache {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
  evictBefore(day: string): Promise<void>;
}

export function dayKey(stationId: string, seriesCode: string, day: string): string {
  return `${stationId}|${seriesCode}|${day}`;
}

function keyDay(key: string): string {
  return key.split("|")[2] ?? "";
}

export function memoryCache(): ChsCache {
  const store = new Map<string, unknown>();
  return {
    async get(key) { return store.has(key) ? store.get(key)! : null; },
    async set(key, value) { store.set(key, value); },
    async evictBefore(day) {
      for (const key of [...store.keys()]) if (keyDay(key) && keyDay(key) < day) store.delete(key);
    },
  };
}

const DB = "slackwater-chs";
const STORE = "days";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function indexedDbCache(): ChsCache {
  // ponytail: IDB impl covered by the offline smoke check in a real browser, not a
  // jsdom fake — add fake-indexeddb only if this grows logic worth unit-testing.
  return {
    async get(key) { const db = await openDb(); return (await tx(db, "readonly", (s) => s.get(key))) ?? null; },
    async set(key, value) { const db = await openDb(); await tx(db, "readwrite", (s) => s.put(value, key)); },
    async evictBefore(day) {
      const db = await openDb();
      const keys = await tx<IDBValidKey[]>(db, "readonly", (s) => s.getAllKeys());
      for (const k of keys) {
        if (typeof k === "string" && keyDay(k) && keyDay(k) < day) {
          await tx(db, "readwrite", (s) => s.delete(k));
        }
      }
    },
  };
}
