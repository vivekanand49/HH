// Family accounts: one phone manages health profiles for the family —
// children, and elderly parents who have no smartphone. The app then sends
// X-Profile-Id to act for a member (see middleware/auth.js).
//  * A member with no phone of their own is created by the guardian.
//  * A member with a phone must agree: an OTP goes to their phone and they
//    read it out to the guardian. Their existing records stay their own.
//  * Either side can remove the link at any time.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { one, query } from '../db/index.js';
import { parse } from '../validate.js';
import { idHash, maskPhone, normalizePhone, otpCode, safeEqual } from '../services/ids.js';
import { createUser } from '../services/users.js';
import { sendTemplate } from '../services/sms.js';
import { audit } from '../services/audit.js';
import { requireAuth } from '../middleware/auth.js';
import { MAX_ATTEMPTS, MAX_OTP_PER_HOUR, OTP_TTL_MIN } from './auth.js';

const r = Router();
r.use(requireAuth);

const MAX_MEMBERS = 10;
const RELATIONS = ['spouse', 'child', 'parent', 'sibling', 'grandparent', 'grandchild', 'other'];

// Only personal (patient) accounts have a family. Always the signed-in person, never the profile in use.
function guardianOf(req, res) {
  if (req.actor.role !== 'patient') {
    res.status(403).json({ error: 'Family profiles are for personal accounts.' });
    return null;
  }
  return req.actor;
}

const memberView = (m) => ({
  id: m.id,
  full_name: m.full_name,
  relation: m.relation,
  gender: m.gender,
  date_of_birth: m.date_of_birth,
  blood_group: m.blood_group,
  language: m.language,
  sos_code: m.sos_code,
  phone_masked: maskPhone(m.phone),
  aadhaar_last4: m.aadhaar_last4,
  abha_number: m.abha_number,
  records_consent: Boolean(m.records_consent_at),
  reminders_enabled: m.reminders_enabled,
  reminder_sms: m.reminder_sms,
  emergency_contact_name: m.emergency_contact_name,
  emergency_contact_phone: m.emergency_contact_phone,
  lat: m.lat,
  lng: m.lng,
  role: 'patient',
});

// Profiles I manage, and people who manage my profile.
r.get('/', async (req, res) => {
  const me = req.actor;
  const [members, managers] = await Promise.all([
    query(
      `SELECT u.*, f.relation FROM family_links f JOIN users u ON u.id = f.member_id
        WHERE f.guardian_id = $1 AND u.is_active ORDER BY f.created_at`,
      [me.id],
    ),
    query(
      `SELECT u.id, u.full_name, u.phone, f.relation, f.created_at FROM family_links f JOIN users u ON u.id = f.guardian_id
        WHERE f.member_id = $1 ORDER BY f.created_at`,
      [me.id],
    ),
  ]);
  res.json({
    members: members.rows.map(memberView),
    managedBy: managers.rows.map((g) => ({ id: g.id, full_name: g.full_name, phone_masked: maskPhone(g.phone), since: g.created_at })),
  });
});

const addSchema = z.object({
  relation: z.enum(RELATIONS),
  full_name: z.string().trim().min(2).max(120),
  gender: z.enum(['female', 'male', 'other']).optional(),
  date_of_birth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  blood_group: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
  language: z.enum(['en', 'te', 'hi', 'mr']).optional(),
  // Their own mobile, if they have one: they must then agree by OTP.
  phone: z.string().optional(),
});

// Tighter than the global limit: each request with a phone sends an SMS.
const linkLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, message: { error: 'Too many requests. Please try again later.' } });

r.post('/', linkLimit, async (req, res) => {
  const me = guardianOf(req, res);
  if (!me) return;
  const b = parse(addSchema, req.body);
  if (b.date_of_birth && new Date(b.date_of_birth) > new Date()) return res.status(400).json({ error: 'Date of birth cannot be in the future.' });
  const { n } = await one(`SELECT count(*)::int AS n FROM family_links WHERE guardian_id = $1`, [me.id]);
  if (n >= MAX_MEMBERS) return res.status(400).json({ error: `You can manage up to ${MAX_MEMBERS} family members.` });

  if (!b.phone) {
    // No phone of their own: the guardian creates the profile and is the emergency contact.
    const member = await createUser({
      role: 'patient',
      full_name: b.full_name,
      gender: b.gender ?? null,
      date_of_birth: b.date_of_birth ?? null,
      blood_group: b.blood_group ?? null,
      language: b.language ?? me.language,
      emergency_contact_name: me.full_name,
      emergency_contact_phone: me.phone,
      lat: me.lat,
      lng: me.lng,
      location_updated_at: me.lat != null ? new Date() : null,
      registered_by: me.id,
      // The guardian agrees on their behalf (parent for a child, carer for an elder).
      records_consent_at: new Date(),
    });
    await query(`INSERT INTO family_links (guardian_id, member_id, relation) VALUES ($1, $2, $3)`, [me.id, member.id, b.relation]);
    await audit(me.id, 'family_add', 'user', member.id, { relation: b.relation, consent: 'given by guardian' });
    return res.status(201).json({ member: memberView({ ...member, relation: b.relation }) });
  }

  const phone = normalizePhone(b.phone);
  if (!phone) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number, or leave it empty.' });
  if (phone === me.phone) return res.status(400).json({ error: 'That is your own number.' });
  let member = await one(`SELECT * FROM users WHERE phone = $1`, [phone]);
  if (member && (!member.is_active || member.role !== 'patient')) return res.status(400).json({ error: 'This number cannot be added as a family member.' });
  if (member && (await one(`SELECT 1 FROM family_links WHERE guardian_id = $1 AND member_id = $2`, [me.id, member.id]))) {
    return res.status(409).json({ error: 'This person is already in your family.' });
  }
  member ??= await createUser({
    phone,
    full_name: b.full_name,
    gender: b.gender ?? null,
    date_of_birth: b.date_of_birth ?? null,
    blood_group: b.blood_group ?? null,
    language: b.language ?? me.language,
  });
  const recent = await one(`SELECT count(*)::int AS n FROM otp_requests WHERE user_id = $1 AND created_at > now() - interval '1 hour'`, [member.id]);
  if (recent.n >= MAX_OTP_PER_HOUR) return res.status(429).json({ error: 'Too many codes sent to this number. Please try again in an hour.' });

  const code = otpCode();
  const otp = await one(
    `INSERT INTO otp_requests (user_id, code_hash, expires_at, purpose, meta)
     VALUES ($1, $2, now() + interval '${OTP_TTL_MIN} minutes', 'family_link', $3) RETURNING id`,
    [member.id, idHash(`otp:${code}`), JSON.stringify({ guardian_id: me.id, relation: b.relation })],
  );
  await sendTemplate(phone, 'family_link', member.language, { code, name: me.full_name || maskPhone(me.phone) });
  res.status(202).json({
    needsCode: true,
    requestId: otp.id,
    sentTo: maskPhone(phone),
    expiresInSec: OTP_TTL_MIN * 60,
    ...(config.otpDevEcho ? { devCode: code } : {}),
  });
});

const confirmSchema = z.object({ requestId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) });

// The member read out the code from their phone: link them.
r.post('/confirm', linkLimit, async (req, res) => {
  const me = guardianOf(req, res);
  if (!me) return;
  const { requestId, code } = parse(confirmSchema, req.body);
  const otp = await one(`SELECT * FROM otp_requests WHERE id = $1 AND purpose = 'family_link'`, [requestId]);
  // Only the guardian who asked can use the code.
  if (!otp || otp.meta?.guardian_id !== me.id) return res.status(400).json({ error: 'Request not found. Please start again.' });
  if (otp.consumed_at) return res.status(400).json({ error: 'This code was already used. Please start again.' });
  if (new Date(otp.expires_at) < new Date()) return res.status(400).json({ error: 'The code has expired. Please start again.' });
  if (otp.attempts >= MAX_ATTEMPTS) return res.status(429).json({ error: 'Too many wrong tries. Please start again.' });

  if (!safeEqual(otp.code_hash, idHash(`otp:${code}`))) {
    await query(`UPDATE otp_requests SET attempts = attempts + 1 WHERE id = $1`, [requestId]);
    const left = MAX_ATTEMPTS - otp.attempts - 1;
    return res.status(400).json({ error: `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.`, attemptsLeft: left });
  }
  // Claim the code atomically so a double tap can't use it twice.
  const claimed = await one(`UPDATE otp_requests SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id`, [requestId]);
  if (!claimed) return res.status(400).json({ error: 'This code was already used. Please start again.' });

  await query(`INSERT INTO family_links (guardian_id, member_id, relation) VALUES ($1, $2, $3) ON CONFLICT (guardian_id, member_id) DO NOTHING`, [
    me.id,
    otp.user_id,
    otp.meta.relation,
  ]);
  await audit(me.id, 'family_add', 'user', otp.user_id, { relation: otp.meta.relation, consent: 'OTP from member phone' });
  const member = await one(`SELECT u.*, f.relation FROM family_links f JOIN users u ON u.id = f.member_id WHERE f.guardian_id = $1 AND f.member_id = $2`, [
    me.id,
    otp.user_id,
  ]);
  res.status(201).json({ member: memberView(member) });
});

// Remove a link: a guardian removes a member, or a member removes a guardian.
// The member's profile and records are kept.
r.delete('/:id', async (req, res) => {
  const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
  const me = req.actor;
  const { rows } = await query(`DELETE FROM family_links WHERE (guardian_id = $1 AND member_id = $2) OR (guardian_id = $2 AND member_id = $1) RETURNING *`, [
    me.id,
    id,
  ]);
  if (!rows.length) return res.status(404).json({ error: 'Not in your family list.' });
  await audit(me.id, 'family_remove', 'user', id);
  res.json({ ok: true });
});

export default r;
