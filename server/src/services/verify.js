// Twilio Verify: Twilio makes, sends and checks the login code. Used when
// TWILIO_VERIFY_SERVICE_SID is set, for example on a Twilio trial account,
// which may only send Twilio's own texts, not ours.
import { config } from '../config.js';

export const VERIFY_MARK = 'twilio-verify'; // stored instead of our own code hash

export function verifyEnabled() {
  return config.smsProvider === 'twilio' && Boolean(config.twilioVerifyService && config.twilioSid && config.twilioToken);
}

async function call(path, form) {
  const { twilioSid: sid, twilioToken: token } = config;
  const res = await fetch(`${config.twilioVerifyUrl}/Services/${config.twilioVerifyService}/${path}`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(10_000),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`Twilio Verify ${res.status}: ${out.message || 'error'}`), { status: res.status });
  return out;
}

/** Sends a login code to the phone by SMS. Throws if Twilio refuses. */
export async function startVerification(phone) {
  await call('Verifications', { To: phone, Channel: 'sms' });
}

/** true if the code is right. Twilio answers 404 once a code is used up or expired. */
export async function checkVerification(phone, code) {
  try {
    return (await call('VerificationCheck', { To: phone, Code: code })).status === 'approved';
  } catch (err) {
    if (err.status === 404) return false;
    throw err;
  }
}
