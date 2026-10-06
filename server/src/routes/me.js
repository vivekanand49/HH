import express, { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../db/index.js';
import { parse } from '../validate.js';
import { normalizePhone } from '../services/ids.js';
import { audit } from '../services/audit.js';
import { RECORD_TYPES, checkUpload, saveFile } from '../services/storage.js';
import { publicUser, requireAuth } from '../middleware/auth.js';

const r = Router();
r.use(requireAuth);

r.get('/', (req, res) => res.json({ user: publicUser(req.user) }));

const profileSchema = z.object({
  full_name: z.string().trim().min(1).max(120).optional(),
  language: z.enum(['en', 'te', 'hi', 'mr']).optional(),
  blood_group: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
  gender: z.enum(['female', 'male', 'other']).optional(),
  date_of_birth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  emergency_contact_name: z.string().trim().max(120).optional(),
  emergency_contact_phone: z.string().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  records_consent: z.boolean().optional(),
  reminders_enabled: z.boolean().optional(),
  reminder_sms: z.boolean().optional(),
});

r.patch('/', async (req, res) => {
  const body = parse(profileSchema, req.body);
  const sets = [];
  const params = [req.user.id];
  const set = (col, val) => sets.push(`${col} = $${params.push(val)}`);

  for (const col of ['full_name', 'language', 'blood_group', 'gender', 'date_of_birth', 'emergency_contact_name', 'reminders_enabled', 'reminder_sms']) {
    if (body[col] !== undefined) set(col, body[col]);
  }
  if (body.emergency_contact_phone !== undefined) {
    const p = normalizePhone(body.emergency_contact_phone);
    if (!p) return res.status(400).json({ error: 'Enter a valid 10-digit emergency contact number.' });
    set('emergency_contact_phone', p);
  }
  if (body.lat !== undefined && body.lng !== undefined) {
    set('lat', body.lat);
    set('lng', body.lng);
    sets.push('location_updated_at = now()');
  }
  if (body.records_consent !== undefined) sets.push(`records_consent_at = ${body.records_consent ? 'now()' : 'NULL'}`);
  if (!sets.length) return res.json({ user: publicUser(req.user) });

  const user = await one(`UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  if (body.records_consent !== undefined) await audit(req.actor.id, body.records_consent ? 'consent_given' : 'consent_withdrawn', 'user', user.id);
  res.json({ user: publicUser(user) });
});

// Everything the home dashboard needs in one request (cheap on 2G).
r.get('/summary', async (req, res) => {
  const id = req.user.id;
  const [next, meds, conditions, counts] = await Promise.all([
    one(
      `SELECT a.id, a.starts_at, a.token, a.room, a.fee_inr, a.status, a.visit_type,
              d.full_name AS doctor_name, d.department, d.opd_block, h.name AS hospital_name, h.type AS hospital_type
         FROM appointments a JOIN doctors d ON d.id = a.doctor_id JOIN hospitals h ON h.id = a.hospital_id
        WHERE a.patient_id = $1 AND a.status IN ('confirmed', 'pending_payment') AND a.starts_at > now()
        ORDER BY a.starts_at LIMIT 1`,
      [id],
    ),
    query(`SELECT id, name, dose, times, instructions FROM medications WHERE patient_id = $1 AND is_active ORDER BY name`, [id]),
    query(`SELECT id, kind, name, status FROM health_conditions WHERE patient_id = $1 AND status <> 'resolved' ORDER BY kind DESC, name`, [id]),
    one(
      `SELECT count(*)::int AS records, count(DISTINCT hospital_id)::int AS hospitals, max(created_at) AS updated_at
         FROM medical_records WHERE patient_id = $1`,
      [id],
    ),
  ]);
  res.json({ nextAppointment: next, medications: meds.rows, conditions: conditions.rows, records: counts });
});

r.get('/records', async (req, res) => {
  const { kind } = parse(z.object({ kind: z.enum(['lab', 'prescription', 'imaging', 'discharge', 'vaccination', 'other']).optional() }), req.query);
  const params = [req.user.id];
  const { rows } = await query(
    `SELECT r.id, r.kind, r.title, r.summary, r.recorded_on, r.file_id, f.mime AS file_mime, r.uploaded_by IS NOT NULL AS uploaded,
            h.name AS hospital_name, d.full_name AS doctor_name
       FROM medical_records r LEFT JOIN hospitals h ON h.id = r.hospital_id LEFT JOIN doctors d ON d.id = r.doctor_id
       LEFT JOIN files f ON f.id = r.file_id
      WHERE r.patient_id = $1 ${kind ? `AND r.kind = $${params.push(kind)}` : ''}
      ORDER BY r.recorded_on DESC`,
    params,
  );
  res.json({ records: rows });
});

// Photo or PDF of a paper report. The app shrinks photos before sending,
// so a typical upload is 150–400 KB even on 2G.
const uploadSchema = z.object({
  title: z.string().trim().min(1).max(120),
  kind: z.enum(['lab', 'prescription', 'imaging', 'discharge', 'vaccination', 'other']).default('other'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

r.post('/records/upload', express.raw({ type: Object.keys(RECORD_TYPES), limit: '8mb' }), async (req, res) => {
  const meta = parse(uploadSchema, req.query);
  const check = checkUpload(req.body, req.get('content-type'), RECORD_TYPES);
  if (check.error) return res.status(400).json({ error: check.error });
  const file = await saveFile({ buffer: req.body, mime: check.mime, ext: check.ext, kind: 'record', ownerId: req.user.id });
  const record = await one(
    `INSERT INTO medical_records (patient_id, kind, title, recorded_on, file_id, uploaded_by)
     VALUES ($1, $2, $3, COALESCE($4::date, (now() AT TIME ZONE 'Asia/Kolkata')::date), $5, $1) RETURNING *`,
    [req.user.id, meta.kind, meta.title, meta.date ?? null, file.id],
  );
  await audit(req.actor.id, 'upload', 'medical_record', record.id, req.actor.id !== req.user.id ? { for: req.user.id } : null);
  res.status(201).json({ record: { ...record, file_mime: file.mime, uploaded: true } });
});

// Health readings (BP, sugar…) recorded by the ASHA worker or at a visit.
r.get('/vitals', async (req, res) => {
  const { rows } = await query(
    `SELECT v.id, v.recorded_at, v.systolic, v.diastolic, v.pulse, v.sugar_mgdl, v.sugar_type, v.temperature_f, v.weight_kg, v.spo2, v.notes,
            u.full_name AS recorded_by_name
       FROM vitals v LEFT JOIN users u ON u.id = v.recorded_by
      WHERE v.patient_id = $1 ORDER BY v.recorded_at DESC LIMIT 20`,
    [req.user.id],
  );
  res.json({ vitals: rows });
});

r.get('/appointments', async (req, res) => {
  const { rows } = await query(
    `SELECT a.*, d.full_name AS doctor_name, d.department, h.name AS hospital_name, h.type AS hospital_type, h.address AS hospital_address
       FROM appointments a JOIN doctors d ON d.id = a.doctor_id JOIN hospitals h ON h.id = a.hospital_id
      WHERE a.patient_id = $1 ORDER BY a.starts_at DESC LIMIT 50`,
    [req.user.id],
  );
  res.json({ appointments: rows });
});

export default r;
