// Compact SOS SMS format, short enough for one 160-character SMS:
//   SOS P<sosCode> LOC<lat>,<lng> <CODE,CODE> SEV<1-4>
// e.g. SOS PLD4821 LOC17.6912,83.2178 CHEST,BREATH SEV4
// The phone builds it (no internet needed); the SMS gateway webhook parses it.

import { SEVERITIES, SYMPTOMS } from './triage.js';

export function encodeSosSms({ sosCode, lat, lng, codes = [], severity }) {
  const parts = ['SOS'];
  if (sosCode) parts.push(`P${sosCode}`);
  if (Number.isFinite(lat) && Number.isFinite(lng)) parts.push(`LOC${lat.toFixed(4)},${lng.toFixed(4)}`);
  if (codes.length) parts.push(codes.join(','));
  const sev = SEVERITIES.indexOf(severity);
  if (sev >= 0) parts.push(`SEV${sev + 1}`);
  return parts.join(' ');
}

export function parseSosSms(text) {
  const tokens = String(text || '').trim().toUpperCase().split(/\s+/);
  if (tokens[0] !== 'SOS') return null;
  const out = { sosCode: null, lat: null, lng: null, codes: [], severity: null };
  for (const tok of tokens.slice(1)) {
    let m;
    if ((m = tok.match(/^P([A-Z0-9]{4,12})$/))) out.sosCode = m[1];
    else if ((m = tok.match(/^LOC(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/))) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) Object.assign(out, { lat, lng });
    } else if ((m = tok.match(/^SEV([1-4])$/))) out.severity = SEVERITIES[Number(m[1]) - 1];
    else out.codes.push(...tok.split(',').filter((c) => SYMPTOMS[c]));
  }
  return out;
}

// sms: links differ slightly between iOS and Android; "?&body=" works on both.
export function smsHref(number, body) {
  return `sms:${number}?&body=${encodeURIComponent(body)}`;
}
