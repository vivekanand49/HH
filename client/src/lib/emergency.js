import { api, apiUpload } from './api';
import { store } from '../store';
import { outboxAll, outboxDelete, outboxPut } from './offline';

export function newClientRef() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Outbox entries: { clientRef, payload, profileId, sent, voice?: Blob, queuedAt }
//  - profileId: the family member the alert is for (null = the signed-in person)
//  - sent=false: the alert itself still has to go
//  - voice: a recording still has to be uploaded (after the alert)

/**
 * Save the alert on the phone first, then try to send it. If sending fails it
 * stays in the outbox and is retried whenever the connection comes back.
 */
export async function sendAlert(payload) {
  const profileId = store.getState().session.profile?.id ?? null;
  await outboxPut({ clientRef: payload.clientRef, payload, profileId, sent: false, queuedAt: Date.now() });
  const send = (pid) => api('/emergency/alerts', { method: 'POST', body: payload, profileId: pid, timeout: 10000 });
  const result = await send(profileId).catch((err) => (err.status === 403 && profileId ? send(null) : Promise.reject(err)));
  await outboxDelete(payload.clientRef);
  return result;
}

/** Attach a voice message to an alert; queued if it can't be sent now. */
export async function sendVoice(clientRef, blob, { alertSent, lang }) {
  const existing = (await outboxAll()).find((x) => x.clientRef === clientRef);
  await outboxPut({ ...(existing ?? { clientRef, sent: alertSent, queuedAt: Date.now() }), voice: blob, voiceLang: lang });
  if (!alertSent && !existing?.sent) return { queued: true };
  try {
    await apiUpload(voicePath(clientRef, lang), blob, { timeout: 60000 });
    await outboxDelete(clientRef);
    return { queued: false };
  } catch (err) {
    if (err.status === 0) return { queued: true };
    await outboxDelete(clientRef);
    throw err;
  }
}

const voicePath = (clientRef, lang) => `/emergency/voice?clientRef=${encodeURIComponent(clientRef)}${lang ? `&lang=${lang}` : ''}`;

let flushing = false;
export async function flushOutbox() {
  if (flushing) return [];
  flushing = true;
  const sent = [];
  try {
    for (const item of await outboxAll()) {
      try {
        if (!item.sent && item.payload) {
          // Sent for the person it was raised for, even if the phone switched profile since.
          const send = (profileId) => api('/emergency/alerts', { method: 'POST', body: item.payload, profileId, timeout: 10000 });
          // If that family link is gone, never drop an emergency: send it as the signed-in person.
          sent.push(await send(item.profileId ?? null).catch((err) => (err.status === 403 && item.profileId ? send(null) : Promise.reject(err))));
          item.sent = true;
          await outboxPut(item);
        }
        if (item.voice) await apiUpload(voicePath(item.clientRef, item.voiceLang), item.voice, { timeout: 60000 });
        await outboxDelete(item.clientRef);
      } catch (err) {
        if (err.status === 0) break; // still offline; try later
        await outboxDelete(item.clientRef); // rejected by server: don't retry forever
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}
