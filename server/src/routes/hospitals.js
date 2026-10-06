import { Router } from 'express';
import { z } from 'zod';
import { DEFAULT_LOCATION } from '@swasthya/shared/geo';
import { one, query } from '../db/index.js';
import { parse } from '../validate.js';
import { DIST, nearestHospitals } from '../services/alerts.js';

const r = Router();

const listSchema = z.object({
  type: z.enum(['government', 'private']).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  department: z.string().max(80).optional(),
  emergency: z.enum(['1', 'true']).optional(),
  q: z.string().max(80).optional(),
});

// Public (no sign-in): leave out the staff number that receives booking SMS.
const publicHospital = ({ sms_number: _internal, ...h }) => h;

r.get('/hospitals', async (req, res) => {
  const f = parse(listSchema, req.query);
  const lat = f.lat ?? DEFAULT_LOCATION.lat;
  const lng = f.lng ?? DEFAULT_LOCATION.lng;
  let rows = await nearestHospitals(lat, lng, { type: f.type, emergencyOnly: Boolean(f.emergency), limit: 100 });
  if (f.department) rows = rows.filter((h) => h.departments.includes(f.department));
  if (f.q) {
    const q = f.q.toLowerCase();
    rows = rows.filter((h) => `${h.name} ${h.area ?? ''} ${h.address}`.toLowerCase().includes(q));
  }
  res.json({ hospitals: rows.map(publicHospital) });
});

// "Book fastest slot" and voice booking: the earliest free times in a department,
// at most one per hospital, nearby hospitals first (within 25 km when there are any).
const fastestSchema = z.object({
  department: z.string().max(80).default('general'),
  type: z.enum(['government', 'private']).optional(),
  day: z.enum(['today', 'tomorrow']).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

r.get('/fastest', async (req, res) => {
  const f = parse(fastestSchema, req.query);
  const params = [f.lat ?? DEFAULT_LOCATION.lat, f.lng ?? DEFAULT_LOCATION.lng, f.department];
  const where = [`NOT s.is_booked`, `s.starts_at > now() + interval '15 minutes'`, `d.is_active`, `h.is_active`, `d.department = $3`];
  if (f.type) where.push(`h.type = $${params.push(f.type)}`);
  if (f.day) {
    where.push(`(s.starts_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date + ${f.day === 'tomorrow' ? 1 : 0}`);
  }
  const { rows } = await query(
    `SELECT DISTINCT ON (h.id) s.id AS slot_id, s.starts_at, d.id AS doctor_id, d.full_name AS doctor_name, d.department, d.photo_url, d.rating,
            CASE WHEN h.type = 'government' THEN 0 ELSE d.fee_inr END AS fee_inr, h.id AS hospital_id, h.name AS hospital_name, h.area, h.type AS hospital_type,
            round(${DIST('$1', '$2', 'h.')}::numeric, 1)::float AS distance_km
       FROM doctor_slots s JOIN doctors d ON d.id = s.doctor_id JOIN hospitals h ON h.id = d.hospital_id
      WHERE ${where.join(' AND ')}
      ORDER BY h.id, s.starts_at`,
    params,
  );
  const near = rows.filter((o) => o.distance_km <= 25);
  const options = (near.length ? near : rows).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at) || a.distance_km - b.distance_km).slice(0, 3);
  res.json({ options });
});

r.get('/hospitals/:id', async (req, res) => {
  const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
  const hospital = await one(`SELECT * FROM hospitals WHERE id = $1`, [id]);
  if (!hospital) return res.status(404).json({ error: 'Hospital not found' });
  res.json({ hospital: publicHospital(hospital) });
});

r.get('/hospitals/:id/doctors', async (req, res) => {
  const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
  const { department } = parse(z.object({ department: z.string().max(80).optional() }), req.query);
  const params = [id];
  const { rows } = await query(
    `SELECT d.id, d.full_name, d.department, d.qualifications, d.experience_years, d.languages, d.fee_inr, d.video_fee_inr,
            d.rating, d.opd_block, d.room, d.photo_url, h.type AS hospital_type,
            (SELECT min(s.starts_at) FROM doctor_slots s WHERE s.doctor_id = d.id AND NOT s.is_booked AND s.starts_at > now()) AS next_slot
       FROM doctors d JOIN hospitals h ON h.id = d.hospital_id
      WHERE d.hospital_id = $1 AND d.is_active ${department ? `AND d.department = $${params.push(department)}` : ''}
      ORDER BY next_slot NULLS LAST, d.rating DESC NULLS LAST`,
    params,
  );
  res.json({ doctors: rows.map((d) => ({ ...d, fee_inr: d.hospital_type === 'government' ? 0 : d.fee_inr })) });
});

r.get('/doctors/:id/slots', async (req, res) => {
  const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
  const { rows } = await query(
    `SELECT id, starts_at, duration_min, is_booked FROM doctor_slots
      WHERE doctor_id = $1 AND starts_at > now() AND starts_at < now() + interval '8 days'
      ORDER BY starts_at`,
    [id],
  );
  res.json({ slots: rows });
});

export default r;
