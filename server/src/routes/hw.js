// ASHA / health-worker mode. A worker registers villagers (many have no
// smartphone), records vitals on home visits, books appointments and raises
// emergencies for them. Works offline on the worker's phone: every write
// carries a clientRef, so replaying a queued action never duplicates it.
// A worker can only see and act for people they registered.
import { Router } from 'express';
import { z } from 'zod';
import { SYMPTOMS } from '@swasthya/shared/triage';
import { flagVitals } from '@swasthya/shared/vitals';
import { one, query } from '../db/index.js';
import { parse } from '../validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { newSosCode, normalizePhone } from '../services/ids.js';
import { audit } from '../services/audit.js';
import { bookSlot } from '../services/booking.js';
import { createAlert } from '../services/alerts.js';

const r = Router();
r.use(requireAuth, requireRole('health_worker'));

const clientRef = z.string().min(8).max(64);
const idParam = z.object({ id: z.string().uuid() });

async function myPatient(req, res) {
  const { id } = parse(idParam, req.params);
  const p = await one(`SELECT * FROM users WHERE id = $1 AND registered_by = $2 AND is_active`, [id, req.user.id]);
  if (!p) res.status(404).json({ error: 'Person not found in your list.' });
  return p;
}

r.get('/patients', async (req, res) => {
  const { q } = parse(z.object({ q: z.string().max(80).optional() }), req.query);
  const params = [req.user.id];
  const { rows } = await query(
    `SELECT u.id, u.full_name, u.gender, u.date_of_birth, u.village, u.phone IS NOT NULL AS has_phone, u.created_at,
            (SELECT max(recorded_at) FROM vitals v WHERE v.patient_id = u.id) AS last_visit
       FROM users u
      WHERE u.registered_by = $1 AND u.is_active
        ${q ? `AND (u.full_name ILIKE $${params.push(`%${q}%`)} OR u.village ILIKE $${params.length})` : ''}
      ORDER BY u.full_name`,
    params,
  );
  res.json({ patients: rows });
});

const registerSchema = z.object({
  clientRef,
  full_name: z.string().trim().min(2).max(120),
  gender: z.enum(['female', 'male', 'other']),
  age_years: z.number().int().min(0).max(120),
  village: z.string().trim().min(2).max(120),
  phone: z.string().optional(),
  language: z.enum(['en', 'te', 'hi', 'mr']).default('te'),
  emergency_contact_name: z.string().trim().max(120).optional(),
  emergency_contact_phone: z.string().optional(),
  // The worker confirms the person agreed (spoken consent) to records being kept.
  consent: z.literal(true),
});

r.post('/patients', async (req, res) => {
  const b = parse(registerSchema, req.body);
  const existing = await one(`SELECT id, registered_by FROM users WHERE client_ref = $1`, [b.clientRef]);
  if (existing) {
    if (existing.registered_by !== req.user.id) return res.status(409).json({ error: 'Duplicate request.' });
    return res.json({ patient: await one(`SELECT id, full_name, village FROM users WHERE id = $1`, [existing.id]), duplicate: true });
  }
  const phone = b.phone ? normalizePhone(b.phone) : null;
  if (b.phone && !phone) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number, or leave it empty.' });
  if (phone && (await one(`SELECT 1 FROM users WHERE phone = $1`, [phone]))) {
    return res.status(409).json({ error: 'This mobile number is already registered. The person can sign in themselves.' });
  }
  const contact = b.emergency_contact_phone ? normalizePhone(b.emergency_contact_phone) : null;
  const dob = new Date();
  dob.setFullYear(dob.getFullYear() - b.age_years, 0, 1); // year of birth only

  let patient = null;
  for (let i = 0; i < 5 && !patient; i++) {
    try {
      patient = await one(
        `INSERT INTO users (role, full_name, gender, date_of_birth, village, phone, language, emergency_contact_name, emergency_contact_phone,
                            registered_by, client_ref, sos_code, records_consent_at)
         VALUES ('patient', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         RETURNING id, full_name, village, sos_code`,
        [b.full_name, b.gender, dob.toISOString().slice(0, 10), b.village, phone, b.language, b.emergency_contact_name ?? null, contact, req.user.id, b.clientRef, newSosCode()],
      );
    } catch (err) {
      if (err.code !== '23505' || !String(err.detail || err.message).includes('sos_code')) throw err;
    }
  }
  await audit(req.user.id, 'register_patient', 'user', patient.id, { consent: 'verbal, recorded by health worker' });
  res.status(201).json({ patient });
});

r.get('/patients/:id', async (req, res) => {
  const p = await myPatient(req, res);
  if (!p) return;
  const [conditions, meds, vitals, appts] = await Promise.all([
    query(`SELECT kind, name, status FROM health_conditions WHERE patient_id = $1 AND status <> 'resolved'`, [p.id]),
    query(`SELECT name, dose, times, instructions FROM medications WHERE patient_id = $1 AND is_active`, [p.id]),
    query(`SELECT * FROM vitals WHERE patient_id = $1 ORDER BY recorded_at DESC LIMIT 10`, [p.id]),
    query(
      `SELECT a.id, a.starts_at, a.status, a.token, d.full_name AS doctor_name, h.name AS hospital_name
         FROM appointments a JOIN doctors d ON d.id = a.doctor_id JOIN hospitals h ON h.id = a.hospital_id
        WHERE a.patient_id = $1 AND a.starts_at > now() - interval '1 day' AND a.status IN ('confirmed', 'pending_payment')
        ORDER BY a.starts_at`,
      [p.id],
    ),
  ]);
  await audit(req.user.id, 'view_patient', 'user', p.id);
  res.json({
    patient: { id: p.id, full_name: p.full_name, gender: p.gender, date_of_birth: p.date_of_birth, village: p.village, phone: p.phone, sos_code: p.sos_code, language: p.language },
    conditions: conditions.rows,
    medications: meds.rows,
    vitals: vitals.rows,
    appointments: appts.rows,
  });
});

const vitalsSchema = z
  .object({
    clientRef,
    recorded_at: z.string().datetime({ offset: true }).optional(), // when measured (may be earlier, if queued offline)
    systolic: z.number().int().min(50).max(300).optional(),
    diastolic: z.number().int().min(30).max(200).optional(),
    pulse: z.number().int().min(20).max(250).optional(),
    sugar_mgdl: z.number().int().min(20).max(800).optional(),
    sugar_type: z.enum(['fasting', 'random', 'after_meal']).optional(),
    temperature_f: z.number().min(90).max(110).optional(),
    weight_kg: z.number().min(1).max(300).optional(),
    spo2: z.number().int().min(50).max(100).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((v) => ['systolic', 'pulse', 'sugar_mgdl', 'temperature_f', 'weight_kg', 'spo2', 'notes'].some((k) => v[k] !== undefined), {
    message: 'Enter at least one reading',
  })
  .refine((v) => (v.systolic === undefined) === (v.diastolic === undefined), { message: 'Enter both BP numbers' });

r.post('/patients/:id/vitals', async (req, res) => {
  const p = await myPatient(req, res);
  if (!p) return;
  const v = parse(vitalsSchema, req.body);
  const recordedAt = v.recorded_at && new Date(v.recorded_at) <= new Date() ? v.recorded_at : new Date().toISOString();
  const row = await one(
    `INSERT INTO vitals (client_ref, patient_id, recorded_by, recorded_at, systolic, diastolic, pulse, sugar_mgdl, sugar_type, temperature_f, weight_kg, spo2, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (client_ref) DO NOTHING RETURNING *`,
    [v.clientRef, p.id, req.user.id, recordedAt, v.systolic ?? null, v.diastolic ?? null, v.pulse ?? null, v.sugar_mgdl ?? null, v.sugar_type ?? null, v.temperature_f ?? null, v.weight_kg ?? null, v.spo2 ?? null, v.notes ?? null],
  );
  if (!row) return res.json({ vitals: await one(`SELECT * FROM vitals WHERE client_ref = $1 AND patient_id = $2`, [v.clientRef, p.id]), duplicate: true });
  await audit(req.user.id, 'record_vitals', 'user', p.id, { vitals: row.id });
  res.status(201).json({ vitals: row, flags: flagVitals(row) });
});

r.post('/patients/:id/appointments', async (req, res) => {
  const p = await myPatient(req, res);
  if (!p) return;
  const b = parse(z.object({ slotId: z.string().uuid(), complaint: z.string().trim().max(500).optional() }), req.body);
  const out = await bookSlot({ patient: p, actorId: req.user.id, slotId: b.slotId, complaint: b.complaint });
  if (!out) return res.status(409).json({ error: 'That time was just taken. Please pick another.' });
  res.status(201).json(out);
});

const alertSchema = z.object({
  clientRef,
  symptoms: z.array(z.enum(Object.keys(SYMPTOMS))).max(10).default([]),
  note: z.string().max(500).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracy: z.number().min(0).max(100000).optional(),
});

// Emergency for a villager: the worker's GPS is used (they are with the person),
// and the worker's phone is the call-back number if the villager has none.
r.post('/patients/:id/alert', async (req, res) => {
  const p = await myPatient(req, res);
  if (!p) return;
  const b = parse(alertSchema, req.body);
  const out = await createAlert({
    patient: p,
    phone: p.phone ?? req.user.phone,
    channel: 'staff',
    clientRef: b.clientRef,
    symptoms: b.symptoms,
    note: [`Raised by health worker ${req.user.full_name ?? ''} (${req.user.phone ?? ''})`, b.note].filter(Boolean).join('. '),
    lat: b.lat ?? null,
    lng: b.lat != null ? b.lng : null,
    accuracy: b.accuracy != null ? Math.round(b.accuracy) : null,
    raisedBy: req.user.id,
  });
  res.status(out.duplicate ? 200 : 201).json(out);
});

export default r;
