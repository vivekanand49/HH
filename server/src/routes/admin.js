// Hospital admin portal. A hospital_admin manages one hospital (their
// users.hospital_id); the district admin (role admin) can manage every
// hospital and add new ones. Every change is written to the audit log.
import { Router } from 'express';
import { z } from 'zod';
import { one, query, tx } from '../db/index.js';
import { parse } from '../validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { maskPhone, newSosCode, normalizePhone } from '../services/ids.js';
import { audit } from '../services/audit.js';
import { emit } from '../services/realtime.js';
import { sendSms, sendTemplate } from '../services/sms.js';
import { DEPARTMENTS } from '../db/seed.js';

const r = Router();
r.use(requireAuth, requireRole('hospital_admin', 'admin'));

const isDistrict = (user) => user.role === 'admin';
const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:MM');
const phoneField = z.string().max(20).optional().nullable();
const todayIst = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
// Roles an admin can give when adding staff. Doctors get their login from the doctor list.
const STAFF_ROLE_OPTIONS = ['hospital_staff', 'hospital_admin'];

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Loads :hid and checks the admin may manage it.
r.param('hid', async (req, _res, next, hid) => {
  try {
    parse(uuid, hid);
    if (!isDistrict(req.user) && req.user.hospital_id !== hid) throw fail(404, 'Hospital not found');
    req.hospital = await one(`SELECT * FROM hospitals WHERE id = $1`, [hid]);
    if (!req.hospital) throw fail(404, 'Hospital not found');
    next();
  } catch (err) {
    next(err);
  }
});

r.param('did', async (req, _res, next, did) => {
  try {
    parse(uuid, did);
    req.doctor = await one(
      `SELECT d.*, u.phone AS login_phone, u.is_active AS login_active FROM doctors d LEFT JOIN users u ON u.id = d.user_id
        WHERE d.id = $1 AND d.hospital_id = $2`,
      [did, req.params.hid],
    );
    if (!req.doctor) throw fail(404, 'Doctor not found');
    next();
  } catch (err) {
    next(err);
  }
});

// ---- Hospitals ----

r.get('/hospitals', async (req, res) => {
  const params = [];
  const { rows } = await query(
    `SELECT h.id, h.name, h.type, h.area, h.is_active, h.has_emergency, h.beds_free, h.beds_total, h.er_beds_free, h.er_beds_total, h.beds_updated_at,
            (SELECT count(*)::int FROM doctors d WHERE d.hospital_id = h.id AND d.is_active) AS doctors,
            (SELECT count(*)::int FROM users u WHERE u.hospital_id = h.id AND u.role = 'hospital_admin' AND u.is_active) AS admins
       FROM hospitals h
      ${isDistrict(req.user) ? '' : `WHERE h.id = $${params.push(req.user.hospital_id)}`}
      ORDER BY h.type, h.name`,
    params,
  );
  res.json({ hospitals: rows, departments: DEPARTMENTS, district: isDistrict(req.user) });
});

const hospitalFields = {
  address: z.string().trim().min(5).max(300),
  area: z.string().trim().max(120).nullable(),
  pincode: z.string().regex(/^\d{6}$/).nullable(),
  phone: phoneField,
  emergency_phone: phoneField,
  sms_number: phoneField,
  departments: z.array(z.enum(DEPARTMENTS)).max(DEPARTMENTS.length),
  has_emergency: z.boolean(),
};
// Name, type, map position and closing a hospital: district admin only.
const districtFields = {
  name: z.string().trim().min(3).max(160),
  type: z.enum(['government', 'private']),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  is_active: z.boolean(),
};

function phones(b) {
  for (const k of ['phone', 'emergency_phone', 'sms_number']) {
    if (b[k] === undefined || b[k] === null || b[k] === '') {
      if (b[k] === '') b[k] = null;
      continue;
    }
    // Landlines and short codes are allowed here, but only digits, spaces, + and -.
    const v = String(b[k]).trim();
    if (!/^\+?[\d\s-]{3,16}$/.test(v)) throw fail(400, `${k}: enter a valid phone number`);
    b[k] = normalizePhone(v) ?? v.replace(/[\s-]/g, '');
  }
  return b;
}

r.post('/hospitals', requireRole('admin'), async (req, res) => {
  const b = phones(
    parse(
      z.object({
        ...districtFields,
        ...hospitalFields,
        is_active: z.boolean().default(true),
        has_emergency: z.boolean().default(false),
        departments: hospitalFields.departments.default([]),
        area: hospitalFields.area.optional(),
        pincode: hospitalFields.pincode.optional(),
      }),
      req.body,
    ),
  );
  const h = await one(
    `INSERT INTO hospitals (name, type, address, area, pincode, lat, lng, phone, emergency_phone, sms_number, departments, has_emergency, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [b.name, b.type, b.address, b.area ?? null, b.pincode ?? null, b.lat, b.lng, b.phone ?? null, b.emergency_phone ?? null, b.sms_number ?? null, b.departments, b.has_emergency, b.is_active],
  );
  await audit(req.user.id, 'create', 'hospital', h.id, { name: h.name });
  res.status(201).json({ hospital: h });
});

r.get('/hospitals/:hid', async (req, res) => {
  const hid = req.hospital.id;
  const [appts, doctors, idle, alerts, refunds, counter] = await Promise.all([
    query(
      `SELECT status, count(*)::int AS n FROM appointments
        WHERE hospital_id = $1 AND (starts_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
        GROUP BY status`,
      [hid],
    ),
    one(`SELECT count(*)::int AS n FROM doctors WHERE hospital_id = $1 AND is_active`, [hid]),
    // Active doctors patients cannot book: no free slot in the next 7 days.
    query(
      `SELECT d.id, d.full_name, d.department FROM doctors d
        WHERE d.hospital_id = $1 AND d.is_active
          AND NOT EXISTS (SELECT 1 FROM doctor_slots s WHERE s.doctor_id = d.id AND NOT s.is_booked AND s.starts_at > now() AND s.starts_at < now() + interval '7 days')
        ORDER BY d.full_name`,
      [hid],
    ),
    one(`SELECT count(*)::int AS n FROM emergency_alerts WHERE hospital_id = $1 AND status IN ('new', 'acknowledged', 'dispatched')`, [hid]),
    one(`SELECT count(*)::int AS n FROM appointments WHERE hospital_id = $1 AND refund_due`, [hid]),
    one(
      `SELECT count(*)::int AS n FROM appointments
        WHERE hospital_id = $1 AND payment_status = 'at_counter' AND status IN ('confirmed', 'completed') AND starts_at > now() - interval '2 days'`,
      [hid],
    ),
  ]);
  res.json({
    hospital: req.hospital,
    today: Object.fromEntries(appts.rows.map((x) => [x.status, x.n])),
    doctors: doctors.n,
    doctorsWithoutSlots: idle.rows,
    openAlerts: alerts.n,
    refundsDue: refunds.n,
    counterDue: counter.n,
    departments: DEPARTMENTS,
    district: isDistrict(req.user),
  });
});

r.patch('/hospitals/:hid', async (req, res) => {
  const shape = isDistrict(req.user) ? { ...hospitalFields, ...districtFields } : hospitalFields;
  const b = phones(parse(z.object(shape).partial().strict(), req.body));
  const keys = Object.keys(b);
  if (!keys.length) return res.json({ hospital: req.hospital });
  const h = await one(
    `UPDATE hospitals SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
    [req.hospital.id, ...keys.map((k) => b[k])],
  );
  await audit(req.user.id, 'update', 'hospital', h.id, { fields: keys });
  res.json({ hospital: h });
});

const bedsSchema = z
  .object({
    beds_free: z.number().int().min(0).max(10000),
    er_beds_free: z.number().int().min(0).max(1000),
    beds_total: z.number().int().min(0).max(10000).nullable().optional(),
    er_beds_total: z.number().int().min(0).max(1000).nullable().optional(),
  })
  .strict();

// Beds are updated several times a day by the front desk, so this is its own small call.
// Emergency routing uses er_beds_free to skip a full ER when another is close.
r.put('/hospitals/:hid/beds', async (req, res) => {
  const b = parse(bedsSchema, req.body);
  const total = b.beds_total !== undefined ? b.beds_total : req.hospital.beds_total;
  const erTotal = b.er_beds_total !== undefined ? b.er_beds_total : req.hospital.er_beds_total;
  if (total != null && b.beds_free > total) return res.status(400).json({ error: 'Free beds cannot be more than total beds.' });
  if (erTotal != null && b.er_beds_free > erTotal) return res.status(400).json({ error: 'Free emergency beds cannot be more than total emergency beds.' });
  const h = await one(
    `UPDATE hospitals SET beds_free = $2, er_beds_free = $3, beds_total = $4, er_beds_total = $5, beds_updated_at = now() WHERE id = $1 RETURNING *`,
    [req.hospital.id, b.beds_free, b.er_beds_free, total, erTotal],
  );
  await audit(req.user.id, 'update_beds', 'hospital', h.id, { beds_free: h.beds_free, er_beds_free: h.er_beds_free });
  emit([`hospital:${h.id}`, 'dispatch'], 'hospital:beds', { id: h.id, beds_free: h.beds_free, er_beds_free: h.er_beds_free });
  res.json({ hospital: h });
});

// ---- Staff accounts ----

// Patient accounts that were only ever used to sign in can be turned into
// staff logins (a doctor who tried the app on their own phone). Anything with
// health data stays a patient: we never mix a person's records into a staff account.
async function hasPatientData(userId) {
  const row = await one(
    `SELECT EXISTS (SELECT 1 FROM appointments WHERE patient_id = $1)
         OR EXISTS (SELECT 1 FROM medical_records WHERE patient_id = $1)
         OR EXISTS (SELECT 1 FROM vitals WHERE patient_id = $1)
         OR EXISTS (SELECT 1 FROM medications WHERE patient_id = $1)
         OR EXISTS (SELECT 1 FROM health_conditions WHERE patient_id = $1)
         OR EXISTS (SELECT 1 FROM emergency_alerts WHERE patient_id = $1) AS used`,
    [userId],
  );
  return row.used;
}

async function createStaffLogin({ fullName, phone: rawPhone, role, hospitalId, language = 'en' }) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw fail(400, 'Enter a valid 10-digit mobile number.');
  const existing = await one(`SELECT * FROM users WHERE phone = $1`, [phone]);
  if (existing) {
    if (existing.role !== 'patient' || existing.registered_by || existing.aadhaar_hash || existing.abha_number || (await hasPatientData(existing.id))) {
      throw fail(409, 'This mobile number already has an account. Use a different number for the work login.');
    }
    // token_version + 1 signs out the old patient session on every device.
    return one(
      `UPDATE users SET role = $2, full_name = $3, hospital_id = $4, is_active = true, token_version = token_version + 1, records_consent_at = NULL
        WHERE id = $1 RETURNING *`,
      [existing.id, role, fullName, hospitalId],
    );
  }
  for (let i = 0; i < 5; i++) {
    try {
      return await one(
        `INSERT INTO users (role, full_name, phone, hospital_id, language, sos_code) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [role, fullName, phone, hospitalId, language, newSosCode()],
      );
    } catch (err) {
      if (err.code !== '23505' || !String(err.detail || err.message).includes('sos_code')) throw err;
    }
  }
  throw new Error('Could not create user');
}

const staffView = (u) => ({
  id: u.id,
  role: u.role,
  full_name: u.full_name,
  phone_masked: maskPhone(u.phone),
  is_active: u.is_active,
  last_login_at: u.last_login_at,
  created_at: u.created_at,
  doctor_id: u.doctor_id ?? null,
});

r.get('/hospitals/:hid/staff', async (req, res) => {
  const { rows } = await query(
    `SELECT u.*, d.id AS doctor_id FROM users u LEFT JOIN doctors d ON d.user_id = u.id
      WHERE u.hospital_id = $1 AND u.role IN ('hospital_staff', 'hospital_admin', 'doctor')
      ORDER BY u.is_active DESC, u.role, u.full_name`,
    [req.hospital.id],
  );
  res.json({ staff: rows.map(staffView) });
});

r.post('/hospitals/:hid/staff', async (req, res) => {
  const b = parse(
    z.object({ full_name: z.string().trim().min(2).max(120), phone: z.string().max(20), role: z.enum(STAFF_ROLE_OPTIONS), language: z.enum(['en', 'te', 'hi', 'mr']).default('en') }),
    req.body,
  );
  const u = await createStaffLogin({ fullName: b.full_name, phone: b.phone, role: b.role, hospitalId: req.hospital.id, language: b.language });
  await audit(req.user.id, 'create_staff', 'user', u.id, { role: u.role, hospital: req.hospital.id });
  await sendSms(u.phone, `You have been added to Swasthya Setu as ${u.role === 'hospital_admin' ? 'hospital admin' : 'staff'} at ${req.hospital.name}. Sign in with this mobile number.`, { template: 'staff_added' });
  res.status(201).json({ staff: staffView(u) });
});

r.post('/hospitals/:hid/staff/:uid/active', async (req, res) => {
  const { uid } = parse(z.object({ uid: uuid }), req.params);
  const { active } = parse(z.object({ active: z.boolean() }), req.body);
  if (uid === req.user.id) return res.status(400).json({ error: 'You cannot turn off your own account.' });
  // Turning off bumps token_version, so the person is signed out everywhere at once.
  const u = await one(
    `UPDATE users SET is_active = $3, token_version = token_version + CASE WHEN $3 THEN 0 ELSE 1 END
      WHERE id = $1 AND hospital_id = $2 AND role IN ('hospital_staff', 'hospital_admin', 'doctor') RETURNING *`,
    [uid, req.hospital.id, active],
  );
  if (!u) return res.status(404).json({ error: 'Staff member not found' });
  await audit(req.user.id, active ? 'enable_staff' : 'disable_staff', 'user', u.id);
  res.json({ staff: staffView(u) });
});

// ---- Doctors ----

const doctorFields = {
  full_name: z.string().trim().min(3).max(120),
  department: z.enum(DEPARTMENTS),
  qualifications: z.array(z.string().trim().min(1).max(40)).max(8),
  experience_years: z.number().int().min(0).max(70).nullable(),
  languages: z.array(z.string().trim().min(2).max(30)).max(10),
  fee_inr: z.number().int().min(0).max(100000),
  video_fee_inr: z.number().int().min(0).max(100000).nullable(),
  opd_block: z.string().trim().min(1).max(10),
  room: z.string().trim().max(20).nullable(),
};

const doctorView = (d) => ({ ...d, login_phone: undefined, login_phone_masked: maskPhone(d.login_phone), has_login: Boolean(d.user_id) });

r.get('/hospitals/:hid/doctors', async (req, res) => {
  const { rows } = await query(
    `SELECT d.*, u.phone AS login_phone, u.is_active AS login_active,
            (SELECT count(*)::int FROM doctor_slots s WHERE s.doctor_id = d.id AND NOT s.is_booked AND s.starts_at > now() AND s.starts_at < now() + interval '7 days') AS free_slots_7d,
            (SELECT count(*)::int FROM appointments a WHERE a.doctor_id = d.id AND a.status IN ('confirmed', 'pending_payment') AND a.starts_at > now()) AS upcoming
       FROM doctors d LEFT JOIN users u ON u.id = d.user_id
      WHERE d.hospital_id = $1
      ORDER BY d.is_active DESC, d.department, d.full_name`,
    [req.hospital.id],
  );
  res.json({ doctors: rows.map(doctorView) });
});

r.post('/hospitals/:hid/doctors', async (req, res) => {
  const b = parse(
    z.object({
      ...doctorFields,
      qualifications: doctorFields.qualifications.default([]),
      languages: doctorFields.languages.default([]),
      experience_years: doctorFields.experience_years.optional(),
      video_fee_inr: doctorFields.video_fee_inr.optional(),
      room: doctorFields.room.optional(),
      fee_inr: doctorFields.fee_inr.default(0),
      opd_block: doctorFields.opd_block.default('A'),
      login_phone: z.string().max(20).optional(),
    }),
    req.body,
  );
  if (!req.hospital.departments.includes(b.department)) {
    return res.status(400).json({ error: 'Add this department to the hospital first.' });
  }
  // A login is optional: many OPD doctors never use the app themselves.
  const login = b.login_phone
    ? await createStaffLogin({ fullName: b.full_name, phone: b.login_phone, role: 'doctor', hospitalId: req.hospital.id })
    : null;
  const d = await one(
    `INSERT INTO doctors (hospital_id, user_id, full_name, department, qualifications, experience_years, languages, fee_inr, video_fee_inr, opd_block, room)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [req.hospital.id, login?.id ?? null, b.full_name, b.department, b.qualifications, b.experience_years ?? null, b.languages, b.fee_inr, b.video_fee_inr ?? null, b.opd_block, b.room ?? null],
  );
  await audit(req.user.id, 'create', 'doctor', d.id, { login: login?.id ?? null });
  res.status(201).json({ doctor: doctorView({ ...d, login_phone: login?.phone }) });
});

r.patch('/hospitals/:hid/doctors/:did', async (req, res) => {
  const b = parse(z.object({ ...doctorFields, is_active: z.boolean() }).partial().strict(), req.body);
  if (b.department && !req.hospital.departments.includes(b.department)) {
    return res.status(400).json({ error: 'Add this department to the hospital first.' });
  }
  if (b.is_active === false && req.doctor.is_active) {
    const { n } = await one(
      `SELECT count(*)::int AS n FROM appointments WHERE doctor_id = $1 AND status IN ('confirmed', 'pending_payment') AND starts_at > now()`,
      [req.doctor.id],
    );
    if (n > 0) return res.status(409).json({ error: `This doctor still has ${n} upcoming bookings. Mark leave for those days first, so patients are told.` });
  }
  const keys = Object.keys(b);
  if (!keys.length) return res.json({ doctor: doctorView(req.doctor) });
  const d = await tx(async (q) => {
    const { rows: [row] } = await q.query(
      `UPDATE doctors SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
      [req.doctor.id, ...keys.map((k) => b[k])],
    );
    // An inactive doctor's remaining free slots must not be bookable.
    if (b.is_active === false) await q.query(`UPDATE doctor_slots SET is_booked = true WHERE doctor_id = $1 AND NOT is_booked AND starts_at > now()`, [row.id]);
    return row;
  });
  await audit(req.user.id, 'update', 'doctor', d.id, { fields: keys });
  res.json({ doctor: doctorView({ ...d, login_phone: req.doctor.login_phone }) });
});

// Gives an existing doctor profile a login for the doctor app.
r.post('/hospitals/:hid/doctors/:did/login', async (req, res) => {
  const { phone } = parse(z.object({ phone: z.string().max(20) }), req.body);
  if (req.doctor.user_id) return res.status(409).json({ error: 'This doctor already has a login.' });
  const u = await createStaffLogin({ fullName: req.doctor.full_name, phone, role: 'doctor', hospitalId: req.hospital.id });
  const d = await one(`UPDATE doctors SET user_id = $2 WHERE id = $1 AND user_id IS NULL RETURNING *`, [req.doctor.id, u.id]);
  await audit(req.user.id, 'link_login', 'doctor', req.doctor.id, { user: u.id });
  await sendSms(u.phone, `Your doctor login for ${req.hospital.name} is ready in Swasthya Setu. Sign in with this mobile number.`, { template: 'doctor_login' });
  res.status(201).json({ doctor: doctorView({ ...d, login_phone: u.phone }) });
});

// ---- Schedule ----

// Slots in India time. state: free | booked (a live appointment) | blocked (closed by the hospital).
r.get('/hospitals/:hid/doctors/:did/slots', async (req, res) => {
  const { from = todayIst(), days = 7 } = parse(z.object({ from: day.optional(), days: z.coerce.number().int().min(1).max(31).optional() }), req.query);
  const { rows } = await query(
    `SELECT s.id, s.starts_at, s.duration_min, s.is_booked, a.id AS appointment_id, a.token, a.status AS appointment_status, a.visit_type
       FROM doctor_slots s LEFT JOIN appointments a ON a.slot_id = s.id AND a.status <> 'cancelled'
      WHERE s.doctor_id = $1
        AND s.starts_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata')
        AND s.starts_at < (($2::date + $3::int)::timestamp AT TIME ZONE 'Asia/Kolkata')
      ORDER BY s.starts_at`,
    [req.doctor.id, from, days],
  );
  res.json({
    slots: rows.map(({ is_booked: taken, ...s }) => ({ ...s, state: s.appointment_id ? 'booked' : taken ? 'blocked' : 'free' })),
  });
});

const scheduleSchema = z
  .object({
    from: day,
    to: day,
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7), // 0 = Sunday
    start: hhmm,
    end: hhmm,
    duration_min: z.number().int().min(5).max(120),
    break_start: hhmm.optional(),
    break_end: hhmm.optional(),
  })
  .refine((s) => s.start < s.end, { message: 'Start time must be before end time' })
  .refine((s) => s.from <= s.to, { message: 'From date must be before To date' })
  .refine((s) => (s.break_start === undefined) === (s.break_end === undefined), { message: 'Enter both break times, or neither' })
  .refine((s) => !s.break_start || s.break_start < s.break_end, { message: 'Break start must be before break end' });

// Creates OPD slots for a date range. Skips times already past and any time that
// overlaps an existing slot, so running it twice is safe.
r.post('/hospitals/:hid/doctors/:did/schedule', async (req, res) => {
  const s = parse(scheduleSchema, req.body);
  if (!req.doctor.is_active) return res.status(409).json({ error: 'This doctor is marked inactive.' });
  const spanDays = (Date.parse(s.to) - Date.parse(s.from)) / 86400000;
  if (spanDays > 60) return res.status(400).json({ error: 'Make a schedule for at most 60 days at a time.' });
  if (s.to < todayIst()) return res.status(400).json({ error: 'These dates are in the past.' });

  const { rows } = await query(
    `WITH wanted AS (
       SELECT (t AT TIME ZONE 'Asia/Kolkata') AS starts_at
         FROM generate_series($2::date::timestamp, $3::date::timestamp, interval '1 day') AS d,
              LATERAL generate_series(d + $5::time, d + $6::time - make_interval(mins => $4), make_interval(mins => $4)) AS t
        WHERE extract(dow FROM d)::int = ANY($7::int[])
          AND NOT ($8::time IS NOT NULL AND t::time < $9::time AND (t + make_interval(mins => $4))::time > $8::time)
     )
     INSERT INTO doctor_slots (doctor_id, starts_at, duration_min)
     SELECT $1, w.starts_at, $4 FROM wanted w
      WHERE w.starts_at > now()
        AND NOT EXISTS (
          SELECT 1 FROM doctor_slots x
           WHERE x.doctor_id = $1
             AND x.starts_at < w.starts_at + make_interval(mins => $4)
             AND x.starts_at + make_interval(mins => x.duration_min) > w.starts_at)
     ON CONFLICT (doctor_id, starts_at) DO NOTHING
     RETURNING id`,
    [req.doctor.id, s.from, s.to, s.duration_min, s.start, s.end, s.weekdays, s.break_start ?? null, s.break_end ?? null],
  );
  await audit(req.user.id, 'schedule', 'doctor', req.doctor.id, { ...s, created: rows.length });
  res.status(201).json({ created: rows.length });
});

// Close or reopen one free slot (e.g. the doctor has a meeting).
r.post('/hospitals/:hid/doctors/:did/slots/:sid/block', async (req, res) => {
  const { sid } = parse(z.object({ sid: uuid }), req.params);
  const { blocked } = parse(z.object({ blocked: z.boolean() }), req.body);
  if (!blocked && !req.doctor.is_active) return res.status(409).json({ error: 'This doctor is marked inactive.' });
  const slot = await one(
    `UPDATE doctor_slots s SET is_booked = $3
      WHERE s.id = $1 AND s.doctor_id = $2 AND s.starts_at > now()
        AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.slot_id = s.id AND a.status <> 'cancelled')
      RETURNING id, starts_at, duration_min`,
    [sid, req.doctor.id, blocked],
  );
  if (!slot) return res.status(409).json({ error: 'This slot is booked or already over.' });
  await audit(req.user.id, blocked ? 'block_slot' : 'open_slot', 'doctor', req.doctor.id, { slot: sid });
  res.json({ slot: { ...slot, state: blocked ? 'blocked' : 'free' } });
});

// Doctor on leave for a day: close every slot that day and cancel the bookings.
// Each patient gets an SMS in their language (villagers without a phone: their ASHA worker).
// Paid visits are flagged refund_due for the accounts desk.
r.post('/hospitals/:hid/doctors/:did/leave', async (req, res) => {
  const b = parse(z.object({ date: day, reason: z.string().trim().max(200).optional() }), req.body);
  if (b.date < todayIst()) return res.status(400).json({ error: 'This date is in the past.' });
  const reason = b.reason || 'Doctor on leave';
  const cancelled = await tx(async (q) => {
    await q.query(
      `UPDATE doctor_slots SET is_booked = true
        WHERE doctor_id = $1 AND (starts_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date AND starts_at > now()`,
      [req.doctor.id, b.date],
    );
    const { rows } = await q.query(
      `UPDATE appointments SET status = 'cancelled', cancel_reason = $3, refund_due = (payment_status = 'paid')
        WHERE doctor_id = $1 AND (starts_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date
          AND status IN ('confirmed', 'pending_payment') AND starts_at > now()
        RETURNING id, patient_id, starts_at, refund_due`,
      [req.doctor.id, b.date, reason],
    );
    return rows;
  });

  const dayLabel = (lang) =>
    new Date(`${b.date}T12:00:00+05:30`).toLocaleDateString({ te: 'te-IN', hi: 'hi-IN', mr: 'mr-IN' }[lang] ?? 'en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' });
  for (const a of cancelled) {
    const p = await one(
      `SELECT u.phone, u.language, w.phone AS worker_phone FROM users u LEFT JOIN users w ON w.id = u.registered_by WHERE u.id = $1`,
      [a.patient_id],
    );
    const to = p?.phone ?? p?.worker_phone;
    if (to) {
      await sendTemplate(to, 'doctorLeave', p.language, { doctor: req.doctor.full_name, day: dayLabel(p.language), hospital: req.hospital.name, refund: a.refund_due });
    }
    emit(`user:${a.patient_id}`, 'appointment:cancelled', { id: a.id });
  }
  await audit(req.user.id, 'doctor_leave', 'doctor', req.doctor.id, { date: b.date, reason, cancelled: cancelled.map((a) => a.id) });
  res.json({ cancelled: cancelled.length, refundsDue: cancelled.filter((a) => a.refund_due).length });
});

// ---- Pay at counter ----

// Upcoming and recent visits the patient chose to pay for at the counter.
r.get('/hospitals/:hid/counter', async (req, res) => {
  const { rows } = await query(
    `SELECT a.id, a.starts_at, a.fee_inr, a.token, d.full_name AS doctor_name, u.full_name AS patient_name, u.phone AS patient_phone
       FROM appointments a JOIN doctors d ON d.id = a.doctor_id JOIN users u ON u.id = a.patient_id
      WHERE a.hospital_id = $1 AND a.payment_status = 'at_counter' AND a.status IN ('confirmed', 'completed')
        AND a.starts_at > now() - interval '2 days'
      ORDER BY a.starts_at`,
    [req.hospital.id],
  );
  res.json({ counter: rows.map(({ patient_phone: ph, ...x }) => ({ ...x, patient_phone_masked: maskPhone(ph) })) });
});

// The counter collected the fee (cash or UPI).
r.post('/hospitals/:hid/counter/:aid', async (req, res) => {
  const { aid } = parse(z.object({ aid: uuid }), req.params);
  const { method } = parse(z.object({ method: z.enum(['cash', 'upi', 'card']) }), req.body);
  const a = await one(
    `UPDATE appointments SET payment_status = 'paid' WHERE id = $1 AND hospital_id = $2 AND payment_status = 'at_counter' RETURNING id`,
    [aid, req.hospital.id],
  );
  if (!a) return res.status(404).json({ error: 'Not found or already collected.' });
  await audit(req.user.id, 'collected_at_counter', 'appointment', aid, { method });
  res.json({ ok: true });
});

// ---- Refunds ----

r.get('/hospitals/:hid/refunds', async (req, res) => {
  const { rows } = await query(
    `SELECT a.id, a.starts_at, a.fee_inr, a.cancel_reason, a.updated_at, d.full_name AS doctor_name, u.full_name AS patient_name, u.phone AS patient_phone,
            p.provider, p.payment_id
       FROM appointments a JOIN doctors d ON d.id = a.doctor_id JOIN users u ON u.id = a.patient_id
       LEFT JOIN LATERAL (SELECT provider, payment_id FROM payments WHERE appointment_id = a.id AND status = 'paid' ORDER BY updated_at DESC LIMIT 1) p ON true
      WHERE a.hospital_id = $1 AND a.refund_due
      ORDER BY a.updated_at`,
    [req.hospital.id],
  );
  res.json({ refunds: rows.map(({ patient_phone: ph, ...x }) => ({ ...x, patient_phone_masked: maskPhone(ph) })) });
});

// Records that the money went back (at the counter, by UPI, or in the Razorpay dashboard).
r.post('/hospitals/:hid/refunds/:aid', async (req, res) => {
  const { aid } = parse(z.object({ aid: uuid }), req.params);
  const { note } = parse(z.object({ note: z.string().trim().min(2).max(200) }), req.body);
  const a = await one(
    `UPDATE appointments SET refund_due = false, payment_status = 'refunded' WHERE id = $1 AND hospital_id = $2 AND refund_due RETURNING id`,
    [aid, req.hospital.id],
  );
  if (!a) return res.status(404).json({ error: 'Refund not found or already done.' });
  await audit(req.user.id, 'refunded', 'appointment', aid, { note });
  res.json({ ok: true });
});

export default r;
