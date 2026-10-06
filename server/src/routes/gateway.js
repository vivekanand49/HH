// Webhooks called by the telecom providers (SMS gateway and missed-call
// service), not by the app. This is how alerts arrive when the phone has
// signal but no internet. Protected by a shared secret header.
import { Router } from 'express';
import { z } from 'zod';
import { parseSosSms } from '@swasthya/shared/sms';
import { config } from '../config.js';
import { one } from '../db/index.js';
import { parse } from '../validate.js';
import { normalizePhone, safeEqual } from '../services/ids.js';
import { createAlert } from '../services/alerts.js';
import { logInboundSms } from '../services/sms.js';

const r = Router();

r.use((req, res, next) => {
  if (!safeEqual(req.get('x-gateway-secret') || '', config.gatewaySecret)) return res.status(401).json({ error: 'bad gateway secret' });
  next();
});

// Provider payloads differ; map yours to { from, text, id } in front of this.
r.post('/sms', async (req, res) => {
  const { from, text, id } = parse(z.object({ from: z.string(), text: z.string().max(1000), id: z.string().max(100).optional() }), req.body);
  const phone = normalizePhone(from) ?? from;
  const sos = parseSosSms(text);
  if (!sos) {
    await logInboundSms(phone, text);
    return res.json({ ok: true, alert: null });
  }
  const patient =
    (sos.sosCode && (await one(`SELECT * FROM users WHERE sos_code = $1`, [sos.sosCode]))) ||
    (await one(`SELECT * FROM users WHERE phone = $1`, [phone]));
  const out = await createAlert({
    patient,
    phone,
    channel: 'sms',
    clientRef: id ? `sms:${id}` : null,
    symptoms: sos.codes,
    severity: sos.severity,
    lat: sos.lat,
    lng: sos.lng,
    locationSource: sos.lat != null ? 'sms' : undefined,
    rawMessage: text,
  });
  await logInboundSms(phone, text, out.alert.id);
  res.json({ ok: true, alert: out.alert.id });
});

r.post('/missed-call', async (req, res) => {
  const { from, id } = parse(z.object({ from: z.string(), id: z.string().max(100).optional() }), req.body);
  const phone = normalizePhone(from) ?? from;
  const patient = await one(`SELECT * FROM users WHERE phone = $1`, [phone]);
  const out = await createAlert({
    patient,
    phone,
    channel: 'missed_call',
    clientRef: id ? `call:${id}` : null,
    severity: 'unknown',
    rawMessage: `Missed call from ${phone}${patient ? '' : ' (not registered)'}`,
  });
  res.json({ ok: true, alert: out.alert.id });
});

export default r;
