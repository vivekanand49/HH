// Health-worker actions are saved on the phone first, then sent in order.
// A visit readings entry for someone registered offline waits until that
// registration has gone through (it refers to it by `patientRef`).
import { api } from './api';
import { cacheGet, cacheSet, hwQueueAll, hwQueueDelete, hwQueuePut } from './offline';
import { newClientRef } from './emergency';

const listeners = new Set();
export function onQueueChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = () => listeners.forEach((fn) => fn());

/**
 * kind: 'register' | 'vitals' | 'alert'
 * For vitals/alert give patientId, or patientRef (the clientRef of a queued registration).
 */
export async function queueAction({ kind, body, patientId, patientRef, label }) {
  const clientRef = body.clientRef ?? newClientRef();
  const item = { clientRef, kind, body: { ...body, clientRef }, patientId, patientRef, label, createdAt: Date.now() };
  await hwQueuePut(item);
  changed();
  return item;
}

async function resolvePatient(item) {
  if (item.patientId) return item.patientId;
  return (await cacheGet(`hwmap:${item.patientRef}`))?.value ?? null;
}

let flushing = null;
export function flushHwQueue() {
  flushing ??= (async () => {
    const results = [];
    try {
      for (const item of await hwQueueAll()) {
        if (item.error) continue; // needs the worker's attention
        try {
          if (item.kind === 'register') {
            const res = await api('/hw/patients', { method: 'POST', body: item.body });
            await cacheSet(`hwmap:${item.clientRef}`, res.patient.id);
            results.push({ item, res });
          } else {
            const pid = await resolvePatient(item);
            if (!pid) continue; // its registration hasn't synced yet
            const path = item.kind === 'vitals' ? `/hw/patients/${pid}/vitals` : `/hw/patients/${pid}/alert`;
            results.push({ item, res: await api(path, { method: 'POST', body: item.body }) });
          }
          await hwQueueDelete(item.clientRef);
        } catch (err) {
          if (err.status === 0 || err.status === 401) break; // offline or signed out: try later
          await hwQueuePut({ ...item, error: err.message });
        }
      }
    } finally {
      flushing = null;
      changed();
    }
    return results;
  })();
  return flushing;
}

export async function discardQueued(clientRef) {
  await hwQueueDelete(clientRef);
  changed();
}

export { hwQueueAll };
