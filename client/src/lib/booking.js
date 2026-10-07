// The earliest free doctors for a department (Book by voice, and the assistant's
// "Book fastest slot"), and booking one of them.
import { api } from './api';

/** Up to 3 options, earliest first; falls back to any day when the asked day is full. */
export async function findFastest({ department = 'general', day, type, loc }) {
  const q = new URLSearchParams({ department });
  if (day) q.set('day', day);
  if (type) q.set('type', type);
  if (loc) {
    q.set('lat', loc.lat);
    q.set('lng', loc.lng);
  }
  let { options } = await api(`/fastest?${q}`);
  if (!options.length && day) {
    q.delete('day');
    ({ options } = await api(`/fastest?${q}`));
  }
  return options;
}

export async function bookOption(option, { visitType = 'in_person', complaint } = {}) {
  const res = await api('/appointments', { method: 'POST', body: { slotId: option.slot_id, visitType, complaint: complaint?.trim().slice(0, 500) || undefined } });
  return res.appointment;
}
