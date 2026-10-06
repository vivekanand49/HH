import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { one, query } from '../db/index.js';
import { parse } from '../validate.js';
import { digits, idHash, maskPhone, normalizePhone, otpCode, safeEqual } from '../services/ids.js';
import { createUser } from '../services/users.js';
import { sendTemplate } from '../services/sms.js';
import { checkVerification, startVerification, VERIFY_MARK, verifyEnabled } from '../services/verify.js';
import { audit } from '../services/audit.js';
import { publicUser, requireAuth, signToken } from '../middleware/auth.js';

const r = Router();
r.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.authRateLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many tries. Please wait a few minutes.' },
  }),
);

export const OTP_TTL_MIN = 5;
// Per person, on top of the per-IP limit: stops someone draining the SMS budget
// by requesting codes for one number from many devices.
export const MAX_OTP_PER_HOUR = 5;
export const MAX_ATTEMPTS = 3;

const requestSchema = z.object({
  method: z.enum(['aadhaar', 'abha', 'mobile']),
  value: z.string().min(10).max(20),
  language: z.enum(['en', 'te', 'hi', 'mr']).optional(),
});

// Step 1: identify the person and send an OTP.
// PRODUCTION NOTE: Aadhaar OTP must come from UIDAI through a licensed AUA/KUA,
// and ABHA OTP from the ABDM gateway. This mock issues our own OTP to the
// registered mobile so the whole flow can be built and demoed now.
r.post('/otp/request', async (req, res) => {
  const { method, value, language } = parse(requestSchema, req.body);
  let user;

  if (method === 'aadhaar') {
    const n = digits(value);
    if (!/^[2-9]\d{11}$/.test(n)) return res.status(400).json({ error: 'Enter a valid 12-digit Aadhaar number.' });
    const hash = idHash(`aadhaar:${n}`);
    user =
      (await one(`SELECT * FROM users WHERE aadhaar_hash = $1`, [hash])) ??
      (await createUser({ aadhaar_hash: hash, aadhaar_last4: n.slice(-4), language: language ?? 'en' }));
  } else if (method === 'abha') {
    const n = digits(value);
    if (!/^\d{14}$/.test(n)) return res.status(400).json({ error: 'Enter a valid 14-digit ABHA number.' });
    const abha = `${n.slice(0, 2)}-${n.slice(2, 6)}-${n.slice(6, 10)}-${n.slice(10)}`;
    user = (await one(`SELECT * FROM users WHERE abha_number = $1`, [abha])) ?? (await createUser({ abha_number: abha, language: language ?? 'en' }));
  } else {
    const phone = normalizePhone(value);
    if (!phone) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
    user = (await one(`SELECT * FROM users WHERE phone = $1`, [phone])) ?? (await createUser({ phone, language: language ?? 'en' }));
  }

  if (!user.is_active) return res.status(403).json({ error: 'This account is disabled.' });
  const recent = await one(`SELECT count(*)::int AS n FROM otp_requests WHERE user_id = $1 AND created_at > now() - interval '1 hour'`, [user.id]);
  if (recent.n >= MAX_OTP_PER_HOUR) return res.status(429).json({ error: 'Too many codes requested. Please try again in an hour.' });

  // With Twilio Verify, Twilio makes and checks the code; otherwise we do and send it ourselves.
  const viaVerify = verifyEnabled() && Boolean(user.phone);
  const code = viaVerify ? null : otpCode();
  if (viaVerify) {
    try {
      await startVerification(user.phone);
    } catch (err) {
      console.error('Login code not sent', err.message);
      return res.status(502).json({ error: 'Could not send the code. Please try again in a minute.' });
    }
  }
  const otp = await one(`INSERT INTO otp_requests (user_id, code_hash, expires_at) VALUES ($1, $2, now() + interval '${OTP_TTL_MIN} minutes') RETURNING id`, [
    user.id,
    viaVerify ? VERIFY_MARK : idHash(`otp:${code}`),
  ]);
  if (user.phone && !viaVerify) await sendTemplate(user.phone, 'otp', user.language, code);

  res.json({
    requestId: otp.id,
    sentTo: maskPhone(user.phone),
    expiresInSec: OTP_TTL_MIN * 60,
    ...(config.otpDevEcho && code ? { devCode: code } : {}),
  });
});

const verifySchema = z.object({ requestId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) });

// Step 2: check the OTP and issue a session token.
r.post('/otp/verify', async (req, res) => {
  const { requestId, code } = parse(verifySchema, req.body);
  const otp = await one(`SELECT * FROM otp_requests WHERE id = $1 AND purpose = 'login'`, [requestId]);
  if (!otp || otp.consumed_at) return res.status(400).json({ error: 'This code was already used. Request a new one.' });
  if (new Date(otp.expires_at) < new Date()) return res.status(400).json({ error: 'The code has expired. Request a new one.' });
  if (otp.attempts >= MAX_ATTEMPTS) return res.status(429).json({ error: 'Too many wrong tries. Request a new code.' });

  let right;
  if (otp.code_hash === VERIFY_MARK) {
    const { phone } = await one(`SELECT phone FROM users WHERE id = $1`, [otp.user_id]);
    try {
      right = await checkVerification(phone, code);
    } catch (err) {
      console.error('Login code check failed', err.message);
      return res.status(502).json({ error: 'Could not check the code. Please try again in a minute.' });
    }
  } else {
    right = safeEqual(otp.code_hash, idHash(`otp:${code}`));
  }
  if (!right) {
    await query(`UPDATE otp_requests SET attempts = attempts + 1 WHERE id = $1`, [requestId]);
    const left = MAX_ATTEMPTS - otp.attempts - 1;
    return res.status(400).json({ error: `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.`, attemptsLeft: left });
  }

  await query(`UPDATE otp_requests SET consumed_at = now() WHERE id = $1`, [requestId]);
  const user = await one(`UPDATE users SET last_login_at = now() WHERE id = $1 RETURNING *`, [otp.user_id]);
  await audit(user.id, 'login', 'user', user.id);
  res.json({ token: signToken(user), user: publicUser(user) });
});

// Sign out everywhere: every token issued before now stops working.
r.post('/logout-all', requireAuth, async (req, res) => {
  const user = await one(`UPDATE users SET token_version = token_version + 1 WHERE id = $1 RETURNING *`, [req.actor.id]);
  await audit(user.id, 'logout_all', 'user', user.id);
  res.json({ ok: true });
});

export default r;
