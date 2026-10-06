import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { one } from '../db/index.js';

export const STAFF_ROLES = ['hospital_staff', 'doctor', 'dispatcher', 'admin'];
// Accounts that can see other people's data get short sessions.
const SHORT_SESSION_ROLES = [...STAFF_ROLES, 'health_worker', 'hospital_admin'];

export function signToken(user) {
  const expiresIn = SHORT_SESSION_ROLES.includes(user.role) ? `${config.staffSessionHours}h` : `${config.patientSessionDays}d`;
  // tv = token version: bumping it on the user signs out every device.
  return jwt.sign({ sub: user.id, role: user.role, tv: user.token_version ?? 0 }, config.jwtSecret, { expiresIn, algorithm: 'HS256' });
}

export async function userFromToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    const user = await one(`SELECT * FROM users WHERE id = $1 AND is_active`, [payload.sub]);
    return user && (payload.tv ?? 0) === user.token_version ? user : null;
  } catch {
    return null;
  }
}

function bearer(req) {
  const h = req.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// Family accounts: the app sends X-Profile-Id to act for a family member.
// req.actor is always the signed-in person (use it for audit and devices);
// req.user becomes the member, so every patient route just works for them.
// Returns false (after replying 403) if the signed-in person may not act for them.
async function actAsProfile(req, res) {
  req.actor = req.user;
  const profileId = req.get('x-profile-id');
  if (!req.user || !profileId || profileId === req.user.id) return true;
  const member = /^[0-9a-f-]{36}$/i.test(profileId)
    ? await one(
        `SELECT u.* FROM family_links f JOIN users u ON u.id = f.member_id
          WHERE f.guardian_id = $1 AND f.member_id = $2 AND u.is_active AND u.role = 'patient'`,
        [req.user.id, profileId],
      )
    : null;
  if (!member) {
    res.status(403).json({ error: 'You cannot manage this family profile.', code: 'bad_profile' });
    return false;
  }
  req.user = member;
  return true;
}

export async function optionalAuth(req, res, next) {
  req.user = await userFromToken(bearer(req));
  if (await actAsProfile(req, res)) next();
}

export async function requireAuth(req, res, next) {
  req.user = await userFromToken(bearer(req));
  if (!req.user) return res.status(401).json({ error: 'Please sign in again.' });
  if (await actAsProfile(req, res)) next();
}

export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Not allowed for your account.' });
    next();
  };

export function publicUser(u) {
  return {
    id: u.id,
    role: u.role,
    full_name: u.full_name,
    phone_masked: u.phone ? `${u.phone.slice(0, 3)} ••••• ${u.phone.slice(-4)}` : null,
    aadhaar_last4: u.aadhaar_last4,
    abha_number: u.abha_number,
    sos_code: u.sos_code,
    language: u.language,
    blood_group: u.blood_group,
    date_of_birth: u.date_of_birth,
    gender: u.gender,
    lat: u.lat,
    lng: u.lng,
    hospital_id: u.hospital_id,
    emergency_contact_name: u.emergency_contact_name,
    emergency_contact_phone: u.emergency_contact_phone,
    records_consent: Boolean(u.records_consent_at),
    reminders_enabled: u.reminders_enabled,
    reminder_sms: u.reminder_sms,
    village: u.village,
  };
}
