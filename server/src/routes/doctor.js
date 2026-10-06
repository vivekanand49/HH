// Doctor app: today's patients, patient summary (with consent), and
// completing a visit with diagnosis and prescription.
import { Router } from 'express';
import { z } from 'zod';
import { one, query, tx } from '../db/index.js';
import { parse } from '../validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { sendSms } from '../services/sms.js';
import { audit } from '../services/audit.js';

const r = Router();
r.use(requireAuth, requireRole('doctor'));

async function myDoctor(req, res, next) {
  req.doctor = await one(`SELECT d.*, h.name AS hospital_name FROM doctors d JOIN hospitals h ON h.id = d.hospital_id WHERE d.user_id = $1`, [req.user.id]);
  if (!req.doctor) return res.status(403).json({ error: 'Your account is not linked to a doctor profile yet.' });
  next();
}
r.use(myDoctor);

r.get('/me', (req, res) => res.json({ doctor: req.doctor }));

r.get('/appointments', async (req, res) => {
  const { rows } = await query(
    `SELECT a.id, a.starts_at, a.status, a.visit_type, a.token, a.room, a.chief_complaint, a.payment_status,
            u.full_name AS patient_name, u.gender, u.date_of_birth
       FROM appointments a JOIN users u ON u.id = a.patient_id
      WHERE a.doctor_id = $1 AND a.status IN ('confirmed', 'completed', 'pending_payment')
        AND a.starts_at > now() - interval '12 hours' AND a.starts_at < now() + interval '7 days'
      ORDER BY a.starts_at`,
    [req.doctor.id],
  );
  res.json({ appointments: rows });
});

r.get('/appointments/:id', async (req, res) => {
  const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
  const a = await one(
    `SELECT a.*, u.full_name AS patient_name, u.gender, u.date_of_birth, u.blood_group, u.language, u.records_consent_at
       FROM appointments a JOIN users u ON u.id = a.patient_id WHERE a.id = $1 AND a.doctor_id = $2`,
    [id, req.doctor.id],
  );
  if (!a) return res.status(404).json({ error: 'Appointment not found' });

  // Allergies are always shown (safety). Full history only with consent.
  const [allergies, history, vitals] = await Promise.all([
    query(`SELECT name FROM health_conditions WHERE patient_id = $1 AND kind = 'allergy' AND status <> 'resolved'`, [a.patient_id]),
    a.records_consent_at
      ? Promise.all([
          query(`SELECT name, status FROM health_conditions WHERE patient_id = $1 AND kind = 'condition' AND status <> 'resolved'`, [a.patient_id]),
          query(`SELECT name, dose, times FROM medications WHERE patient_id = $1 AND is_active`, [a.patient_id]),
          query(
            `SELECT r.kind, r.title, r.summary, r.recorded_on, h.name AS hospital_name FROM medical_records r LEFT JOIN hospitals h ON h.id = r.hospital_id
              WHERE r.patient_id = $1 ORDER BY r.recorded_on DESC LIMIT 10`,
            [a.patient_id],
          ),
        ])
      : null,
    a.records_consent_at
      ? query(`SELECT * FROM vitals WHERE patient_id = $1 ORDER BY recorded_at DESC LIMIT 5`, [a.patient_id])
      : null,
  ]);
  if (history) await audit(req.user.id, 'view_history', 'patient', a.patient_id, { appointment: a.id });
  const { records_consent_at: consent, ...appointment } = a;
  res.json({
    appointment,
    allergies: allergies.rows.map((x) => x.name),
    consent: Boolean(consent),
    conditions: history?.[0].rows ?? null,
    medications: history?.[1].rows ?? null,
    records: history?.[2].rows ?? null,
    vitals: vitals?.rows ?? null,
  });
});

const TIMES = /^([01]\d|2[0-3]):[0-5]\d$/;
const completeSchema = z.object({
  diagnosis: z.string().trim().min(2).max(300),
  advice: z.string().trim().max(1000).optional(),
  followUpDays: z.number().int().min(1).max(365).optional(),
  medicines: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        dose: z.string().trim().max(60).optional(),
        times: z.array(z.string().regex(TIMES)).max(6).default([]),
        days: z.number().int().min(1).max(365),
        instructions: z.string().trim().max(200).optional(),
      }),
    )
    .max(15)
    .default([]),
});

r.post('/appointments/:id/complete', async (req, res) => {
  const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
  const body = parse(completeSchema, req.body);

  const out = await tx(async (q) => {
    const { rows: [a] } = await q.query(
      `UPDATE appointments SET status = 'completed', diagnosis = $3, completed_at = now()
        WHERE id = $1 AND doctor_id = $2 AND status = 'confirmed' RETURNING *`,
      [id, req.doctor.id, body.diagnosis],
    );
    if (!a) return null;
    const lines = body.medicines.map((m) => `${m.name}${m.dose ? ` ${m.dose}` : ''} · ${m.times.join(', ') || 'as needed'} · ${m.days} days${m.instructions ? ` · ${m.instructions}` : ''}`);
    const summary = [body.diagnosis, ...lines, body.advice, body.followUpDays && `Follow-up in ${body.followUpDays} days`].filter(Boolean).join('\n');
    const { rows: [rec] } = await q.query(
      `INSERT INTO medical_records (patient_id, hospital_id, doctor_id, kind, title, summary, recorded_on)
       VALUES ($1, $2, $3, 'prescription', $4, $5, (now() AT TIME ZONE 'Asia/Kolkata')::date) RETURNING id`,
      [a.patient_id, a.hospital_id, a.doctor_id, `Prescription · ${req.doctor.full_name}`, summary],
    );
    for (const m of body.medicines) {
      await q.query(
        `INSERT INTO medications (patient_id, record_id, name, dose, times, instructions, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5, $6, current_date, current_date + $7::int)`,
        [a.patient_id, rec.id, m.name, m.dose ?? null, m.times, m.instructions ?? null, m.days],
      );
    }
    return { a, recordId: rec.id };
  });
  if (!out) return res.status(409).json({ error: 'This visit is already closed or not yours.' });

  await audit(req.user.id, 'complete', 'appointment', id, { record: out.recordId });
  const patient = await one(`SELECT phone FROM users WHERE id = $1`, [out.a.patient_id]);
  if (patient?.phone) {
    await sendSms(patient.phone, `${req.doctor.full_name} has added your prescription in Swasthya Setu. Open the app to see your medicines and reminders.`, {
      template: 'prescription',
    });
  }
  res.json({ appointment: out.a, recordId: out.recordId });
});

export default r;
