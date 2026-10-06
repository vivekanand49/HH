import { query } from '../db/index.js';
import { transcribe } from './speech.js';
import { translate } from './ai.js';
import { alertView } from './alerts.js';
import { emit } from './realtime.js';

// Transcribe an SOS voice message in the caller's language, add an English
// version for the responders, and push the update to the emergency desk.
export async function transcribeAlertVoice(alertId, audio, lang, deps = {}) {
  const text = await (deps.transcribe ?? transcribe)(audio, lang);
  if (!text) return null;
  const english = lang === 'en' ? null : await (deps.translate ?? translate)(text, lang, 'en');
  await query(`UPDATE emergency_alerts SET voice_transcript = $2, voice_transcript_en = $3 WHERE id = $1`, [alertId, text, english]);
  const view = await alertView(alertId);
  emit([`hospital:${view.hospital_id}`, 'dispatch'], 'alert:update', view);
  return { text, english };
}
