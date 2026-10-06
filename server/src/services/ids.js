import crypto from 'node:crypto';
import { config } from '../config.js';

// Keyed hash for identifiers we must look up but never store (Aadhaar),
// and for OTP codes. Constant per ID_HASH_SECRET.
export function idHash(value) {
  return crypto.createHmac('sha256', config.idHashSecret).update(String(value)).digest('hex');
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function otpCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

// Short code a patient's phone puts in an SOS SMS. No 0/O/1/I to avoid misreading.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newSosCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}

export const digits = (v) => String(v || '').replace(/\D/g, '');

// Indian mobile: 10 digits starting 6-9; stored as +91XXXXXXXXXX.
export function normalizePhone(v) {
  const d = digits(v).replace(/^91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}

export function maskPhone(phone) {
  return phone ? `${phone.slice(0, 3)} ••••• ${phone.slice(-4)}` : null;
}
