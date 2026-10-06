import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { EMERGENCY_CODES, SYMPTOMS } from '@swasthya/shared/triage';
import { one, query } from '../db/index.js';
import { parse } from '../validate.js';
import { optionalAuth, requireAuth, requireRole, STAFF_ROLES } from '../middleware/auth.js';
import { normalizePhone } from '../services/ids.js';
import { alertView, createAlert, medicalSummary, openAlerts, updateAlertStatus } from '../services/alerts.js';
import { sendTemplate } from '../services/sms.js';
import { config } from '../config.js';
import { VOICE_TYPES, checkUpload, saveFile } from '../services/storage.js';
import { emit } from '../services/realtime.js';
import { transcribeAlertVoice } from '../services/voice.js';

const r = Router();

// Numbers the phone needs to work fully offline (cached by the app).
r.get('/config', (_req, res) => {
  res.json({
    smsGatewayNumber: config.smsGatewayNumber,
    missedCallNumber: config.missedCallNumber,
    ambulance: '108',
    emergency: '112',
    codes: EMERGENCY_CODES.map((c) => ({ code: c, label: SYMPTOMS[c].label })),
  });
});

const alertSchema = z.object({
  clientRef: z.string().min(8).max(64),
  symptoms: z
    .array(z.enum(Object.keys(SYMPTOMS)))
    .max(10)
    .default([]),
  note: z.string().max(500).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracy: z.number().min(0).max(100000).optional(),
  phone: z.string().optional(),
});

// Never block a real emergency on a login: signed-in users are identified by
// token, others must give a phone number so responders can call back.
r.post(
  '/alerts',
  rateLimit({ windowMs: 60 * 1000, limit: 10, message: { error: 'Too many alerts from this device. If this is a real emergency, call 108.' } }),
  optionalAuth,
  async (req, res) => {
    const body = parse(alertSchema, req.body);
    // A family member without a phone (child, elderly parent): call back the guardian.
    const forFamily = req.user && req.actor.id !== req.user.id;
    const phone = req.user?.phone ?? (forFamily ? req.actor.phone : null) ?? normalizePhone(body.phone);
    if (!req.user && !phone) return res.status(400).json({ error: 'Sign in or give a phone number so help can call you back.' });
    const out = await createAlert({
      patient: req.user,
      phone,
      channel: 'app',
      clientRef: body.clientRef,
      symptoms: body.symptoms,
      note: forFamily ? [`Raised by family member ${req.actor.full_name ?? ''} (${req.actor.phone ?? ''})`, body.note].filter(Boolean).join('. ') : body.note,
      lat: body.lat ?? null,
      lng: body.lat != null ? body.lng : null,
      accuracy: body.accuracy != null ? Math.round(body.accuracy) : null,
      raisedBy: forFamily ? req.actor.id : null,
    });
    res.status(out.duplicate ? 200 : 201).json(out);
  },
);

// Voice message recorded on the phone (possibly offline) and sent after the
// alert. The clientRef is a random ID only the sending phone knows, so it
// works for signed-out users too. One voice message per alert, within 6 hours.
r.post(
  '/voice',
  rateLimit({ windowMs: 60 * 1000, limit: 5, message: { error: 'Too many uploads. Try again in a minute.' } }),
  express.raw({ type: Object.keys(VOICE_TYPES), limit: '3mb' }),
  async (req, res) => {
    const { clientRef, lang } = parse(z.object({ clientRef: z.string().min(8).max(64), lang: z.enum(['en', 'te', 'hi', 'mr']).optional() }), req.query);
    const alert = await one(`SELECT * FROM emergency_alerts WHERE client_ref = $1 AND created_at > now() - interval '6 hours'`, [clientRef]);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    if (alert.voice_file_id) return res.json({ ok: true, duplicate: true });
    const check = checkUpload(req.body, req.get('content-type'), VOICE_TYPES);
    if (check.error) return res.status(400).json({ error: check.error });
    const file = await saveFile({ buffer: req.body, mime: check.mime, ext: check.ext, kind: 'voice', ownerId: alert.patient_id });
    const voiceLang = lang ?? (alert.patient_id ? (await one(`SELECT language FROM users WHERE id = $1`, [alert.patient_id])).language : 'te');
    await query(`UPDATE emergency_alerts SET voice_file_id = $2, voice_language = $3 WHERE id = $1`, [alert.id, file.id, voiceLang]);
    const view = await alertView(alert.id);
    emit([`hospital:${view.hospital_id}`, 'dispatch'], 'alert:update', view);
    res.status(201).json({ ok: true });
    // Speech-to-text runs after the reply, so the phone isn't kept waiting on 2G.
    transcribeAlertVoice(alert.id, req.body, voiceLang).catch((err) => console.warn('Voice transcription failed:', err.message));
  },
);

r.get('/alerts/mine', requireAuth, async (req, res) => {
  const { rows } = await query(`SELECT id FROM emergency_alerts WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 10`, [req.user.id]);
  res.json({ alerts: await Promise.all(rows.map((x) => alertView(x.id))) });
});

r.post('/alerts/:id/cancel', requireAuth, async (req, res) => {
  const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
  const a = await one(`SELECT * FROM emergency_alerts WHERE id = $1 AND patient_id = $2`, [id, req.user.id]);
  if (!a) return res.status(404).json({ error: 'Alert not found' });
  res.json({ alert: await updateAlertStatus(id, req.user, 'cancelled') });
});

// ---- Staff side (hospital emergency desk, 108 dispatch) ----
const staff = [requireAuth, requireRole(...STAFF_ROLES)];
const scopeHospital = (user) => (user.role === 'hospital_staff' || user.role === 'doctor' ? user.hospital_id : null);

async function staffAlert(req, res) {
  const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
  const a = await alertView(id);
  const scope = scopeHospital(req.user);
  if (!a || (scope && a.hospital_id !== scope)) {
    res.status(404).json({ error: 'Alert not found' });
    return null;
  }
  return a;
}

r.get('/alerts', ...staff, async (req, res) => {
  res.json({ alerts: await openAlerts(scopeHospital(req.user)) });
});

r.get('/alerts/:id', ...staff, async (req, res) => {
  const a = await staffAlert(req, res);
  if (!a) return;
  res.json({ alert: a, medical: await medicalSummary(a.patient_id, req.user.id) });
});

r.post('/alerts/:id/ack', ...staff, async (req, res) => {
  const a = await staffAlert(req, res);
  if (!a) return;
  const alert = await updateAlertStatus(a.id, req.user, a.status === 'new' ? 'acknowledged' : a.status, { acknowledge: true });
  if (alert.phone) await sendTemplate(alert.phone, 'alertAck', alert.language, alert.hospital_name || 'The hospital', { alertId: alert.id });
  res.json({ alert });
});

r.post('/alerts/:id/dispatch', ...staff, async (req, res) => {
  const a = await staffAlert(req, res);
  if (!a) return;
  const { ambulanceId } = parse(z.object({ ambulanceId: z.string().uuid().optional() }), req.body ?? {});
  res.json({ alert: await updateAlertStatus(a.id, req.user, 'dispatched', { ambulanceId }) });
});

r.post('/alerts/:id/resolve', ...staff, async (req, res) => {
  const a = await staffAlert(req, res);
  if (!a) return;
  res.json({ alert: await updateAlertStatus(a.id, req.user, 'resolved') });
});

r.get('/ambulances', ...staff, async (_req, res) => {
  const { rows } = await query(`SELECT id, registration, driver_name, driver_phone, status, lat, lng FROM ambulances ORDER BY status, registration`);
  res.json({ ambulances: rows });
});

export default r;
