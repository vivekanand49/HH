// IndexedDB: a small cache of API responses (so records and appointments open
// with no internet) and an outbox of emergency alerts waiting to be sent.
import { openDB } from 'idb';

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = openDB('swasthya-setu', 2, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          d.createObjectStore('cache');
          d.createObjectStore('outbox', { keyPath: 'clientRef' });
        }
        // v2: health-worker actions made offline in the village.
        if (oldVersion < 2) d.createObjectStore('hwqueue', { keyPath: 'clientRef' });
      },
    }).catch(() => null); // IndexedDB blocked: the app still works online
  }
  return dbPromise;
}

export async function cacheSet(key, value) {
  const d = await db();
  await d?.put('cache', { value, savedAt: Date.now() }, key);
}

export async function cacheGet(key) {
  const d = await db();
  return (await d?.get('cache', key)) ?? null;
}

export async function cacheClear() {
  const d = await db();
  await d?.clear('cache');
}

export async function outboxPut(alert) {
  const d = await db();
  await d?.put('outbox', alert);
}

export async function outboxAll() {
  const d = await db();
  return (await d?.getAll('outbox')) ?? [];
}

export async function outboxDelete(clientRef) {
  const d = await db();
  await d?.delete('outbox', clientRef);
}

export async function hwQueuePut(item) {
  const d = await db();
  await d?.put('hwqueue', item);
}

export async function hwQueueAll() {
  const d = await db();
  const all = (await d?.getAll('hwqueue')) ?? [];
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function hwQueueDelete(clientRef) {
  const d = await db();
  await d?.delete('hwqueue', clientRef);
}
