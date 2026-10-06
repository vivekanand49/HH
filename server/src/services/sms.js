import { config } from '../config.js';
import { query } from '../db/index.js';

// Every outgoing SMS goes through here and is logged in sms_log.
// Providers (SMS_PROVIDER):
//  - console: prints the SMS instead of sending it (development, tests)
//  - sns:     AWS SNS, with the DLT entity and template IDs Indian operators require
//  - twilio:  Twilio Messaging (also needs DLT registration for Indian numbers)
// In India every SMS must match a DLT-registered template. Map our template
// names to DLT template IDs in SMS_DLT_TEMPLATES (see .env.example).
let sns = null;
const providers = {
  async console(to, body) {
    console.log(`[sms → ${to}] ${body}`);
    return { status: 'logged' };
  },

  async sns(to, body, { dltTemplateId }) {
    if (!sns) {
      const { SNSClient } = await import('@aws-sdk/client-sns');
      sns = new SNSClient({ region: config.awsRegion });
    }
    const { PublishCommand } = await import('@aws-sdk/client-sns');
    const attr = (v) => ({ DataType: 'String', StringValue: v });
    const out = await sns.send(
      new PublishCommand({
        PhoneNumber: to,
        Message: body,
        MessageAttributes: {
          'AWS.SNS.SMS.SMSType': attr('Transactional'),
          ...(config.smsSenderId && { 'AWS.SNS.SMS.SenderID': attr(config.smsSenderId) }),
          ...(config.smsDltEntityId && { 'AWS.MM.SMS.EntityId': attr(config.smsDltEntityId) }),
          ...(dltTemplateId && { 'AWS.MM.SMS.TemplateId': attr(dltTemplateId) }),
        },
      }),
    );
    return { status: 'sent', providerId: out.MessageId };
  },

  async twilio(to, body) {
    const { twilioSid: sid, twilioToken: token } = config;
    const form = new URLSearchParams({ To: to, Body: body });
    if (config.twilioMessagingService) form.set('MessagingServiceSid', config.twilioMessagingService);
    else form.set('From', config.twilioFrom);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${out.message || 'error'}`);
    return { status: 'sent', providerId: out.sid };
  },
};

export function checkSmsConfig() {
  if (!providers[config.smsProvider]) throw new Error(`Unknown SMS_PROVIDER "${config.smsProvider}"`);
  if (config.smsProvider === 'twilio' && !(config.twilioSid && config.twilioToken && (config.twilioFrom || config.twilioMessagingService))) {
    throw new Error('SMS_PROVIDER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID');
  }
  if (config.isProd && config.smsProvider === 'console') console.warn('SMS_PROVIDER=console: SMS are only printed, not sent');
}

// Indian DLT template IDs differ per language: "otp.te" is tried before "otp".
function dltTemplate(name, lang) {
  if (!name) return undefined;
  return config.smsDltTemplates[`${name}.${lang}`] || config.smsDltTemplates[name];
}

const pending = new Set();

// Logs the SMS as queued and sends it in the background, so a slow SMS
// company never slows down an SOS or a booking. One retry after 3 seconds.
export async function sendSms(to, body, { alertId = null, template: name = null, lang = 'en' } = {}) {
  if (!to) return null;
  const provider = providers[config.smsProvider];
  if (!provider) throw new Error(`Unknown SMS_PROVIDER "${config.smsProvider}"`);
  const row = await query(
    `INSERT INTO sms_log (direction, phone, body, provider, status, alert_id, template) VALUES ('out', $1, $2, $3, 'queued', $4, $5) RETURNING id`,
    [to, body, config.smsProvider, alertId, name],
  );
  const id = row.rows[0].id;
  const opts = { dltTemplateId: dltTemplate(name, lang) };
  const job = (async () => {
    let result;
    for (let attempt = 1; attempt <= 2 && !result; attempt++) {
      try {
        result = await provider(to, body, opts);
      } catch (err) {
        console.error(`SMS send failed (attempt ${attempt})`, err.message);
        if (attempt === 1) await new Promise((r) => setTimeout(r, config.smsRetryMs));
      }
    }
    await query(`UPDATE sms_log SET status = $2, provider_id = $3 WHERE id = $1`, [id, result?.status ?? 'failed', result?.providerId ?? null]);
  })()
    .catch((err) => console.error('SMS log update failed', err))
    .finally(() => pending.delete(job));
  pending.add(job);
  return 'queued';
}

// Renders a patient template in their language and sends it.
export function sendTemplate(to, name, lang, data, opts = {}) {
  return sendSms(to, template(name, lang, data), { ...opts, template: name, lang: T[name][lang] ? lang : 'en' });
}

// Waits for SMS still being sent (graceful shutdown, tests).
export async function flushSms() {
  await Promise.all([...pending]);
}

export async function logInboundSms(from, body, alertId = null) {
  await query(`INSERT INTO sms_log (direction, phone, body, provider, status, alert_id) VALUES ('in', $1, $2, 'gateway', 'received', $3)`, [
    from,
    body,
    alertId,
  ]);
}

// Patient-facing SMS templates in the patient's language.
const T = {
  otp: {
    en: (c) => `${c} is your Swasthya Setu login code. It expires in 5 minutes. Do not share it.`,
    te: (c) => `${c} మీ స్వాస్థ్య సేతు లాగిన్ కోడ్. 5 నిమిషాల్లో గడువు ముగుస్తుంది. ఎవరికీ చెప్పకండి.`,
    hi: (c) => `${c} आपका स्वास्थ्य सेतु लॉगिन कोड है। 5 मिनट में समाप्त होगा। किसी को न बताएँ।`,
    mr: (c) => `${c} हा तुमचा स्वास्थ्य सेतु लॉगिन कोड आहे. 5 मिनिटांत संपेल. कोणालाही सांगू नका.`,
  },
  // The member's "yes" to a relative managing their health profile.
  family_link: {
    en: (a) =>
      `${a.code} is the code to let ${a.name} manage your health profile in Swasthya Setu (appointments, records). Share it with them only if you agree.`,
    te: (a) =>
      `${a.name} మీ స్వాస్థ్య సేతు ఆరోగ్య ప్రొఫైల్‌ను (అపాయింట్‌మెంట్లు, రికార్డులు) నిర్వహించడానికి కోడ్ ${a.code}. మీరు అంగీకరిస్తేనే వారికి చెప్పండి.`,
    hi: (a) => `${a.name} को स्वास्थ्य सेतु में आपकी स्वास्थ्य प्रोफ़ाइल (अपॉइंटमेंट, रिकॉर्ड) संभालने देने का कोड ${a.code} है। सहमत हों तभी उन्हें बताएँ।`,
    mr: (a) =>
      `${a.name} यांना स्वास्थ्य सेतुमध्ये तुमची आरोग्य प्रोफाइल (अपॉइंटमेंट, नोंदी) सांभाळू देण्याचा कोड ${a.code} आहे. तुमची संमती असेल तरच त्यांना सांगा.`,
  },
  payAtCounter: {
    en: (fee) => `Please pay Rs ${fee} at the hospital counter when you arrive.`,
    te: (fee) => `మీరు వచ్చినప్పుడు ఆసుపత్రి కౌంటర్‌లో రూ ${fee} చెల్లించండి.`,
    hi: (fee) => `आने पर अस्पताल काउंटर पर रु ${fee} का भुगतान करें।`,
    mr: (fee) => `आल्यावर रुग्णालयाच्या काउंटरवर रु ${fee} भरा.`,
  },
  booked: {
    en: (a) => `Appointment confirmed at ${a.hospital}. ${a.when}. ${a.doctor}, Room ${a.room}. Token ${a.token}. Please come 10 minutes early.`,
    te: (a) => `${a.hospital} లో అపాయింట్‌మెంట్ ఖరారైంది. ${a.when}. ${a.doctor}, గది ${a.room}. టోకెన్ ${a.token}. 10 నిమిషాల ముందు రండి.`,
    hi: (a) => `${a.hospital} में अपॉइंटमेंट पक्की। ${a.when}. ${a.doctor}, कमरा ${a.room}. टोकन ${a.token}. 10 मिनट पहले आएँ।`,
    mr: (a) => `${a.hospital} येथे भेट निश्चित. ${a.when}. ${a.doctor}, खोली ${a.room}. टोकन ${a.token}. 10 मिनिटे आधी या.`,
  },
  alertAck: {
    en: (h) => `${h} received your emergency alert. Help is coming. Keep your phone switched on.`,
    te: (h) => `${h} మీ అత్యవసర హెచ్చరికను అందుకుంది. సహాయం వస్తోంది. ఫోన్ ఆన్‌లో ఉంచండి.`,
    hi: (h) => `${h} को आपका आपातकालीन अलर्ट मिल गया है। मदद आ रही है। फ़ोन चालू रखें।`,
    mr: (h) => `${h} ला तुमचा आपत्कालीन इशारा मिळाला आहे. मदत येत आहे. फोन चालू ठेवा.`,
  },
  dispatched: {
    en: (a) => `Ambulance ${a.reg} is on the way, about ${a.eta} min. Driver ${a.driver} ${a.phone}.`,
    te: (a) => `అంబులెన్స్ ${a.reg} వస్తోంది, సుమారు ${a.eta} నిమిషాలు. డ్రైవర్ ${a.driver} ${a.phone}.`,
    hi: (a) => `एम्बुलेंस ${a.reg} रास्ते में है, लगभग ${a.eta} मिनट। ड्राइवर ${a.driver} ${a.phone}.`,
    mr: (a) => `रुग्णवाहिका ${a.reg} येत आहे, सुमारे ${a.eta} मिनिटे. चालक ${a.driver} ${a.phone}.`,
  },
  doctorLeave: {
    en: (a) =>
      `Sorry, ${a.doctor} is not available on ${a.day}. Your appointment at ${a.hospital} is cancelled.${a.refund ? ' Your fee will be refunded.' : ''} Please book another time in Swasthya Setu.`,
    te: (a) =>
      `క్షమించండి, ${a.day} న ${a.doctor} అందుబాటులో లేరు. ${a.hospital} లో మీ అపాయింట్‌మెంట్ రద్దయింది.${a.refund ? ' మీ ఫీజు తిరిగి ఇవ్వబడుతుంది.' : ''} దయచేసి స్వాస్థ్య సేతులో మరో సమయం బుక్ చేయండి.`,
    hi: (a) =>
      `क्षमा करें, ${a.day} को ${a.doctor} उपलब्ध नहीं हैं। ${a.hospital} में आपकी अपॉइंटमेंट रद्द हो गई है।${a.refund ? ' आपकी फ़ीस वापस की जाएगी।' : ''} कृपया स्वास्थ्य सेतु में दूसरा समय बुक करें।`,
    mr: (a) =>
      `क्षमस्व, ${a.day} रोजी ${a.doctor} उपलब्ध नाहीत. ${a.hospital} येथील तुमची भेट रद्द झाली आहे.${a.refund ? ' तुमची फी परत केली जाईल.' : ''} कृपया स्वास्थ्य सेतुमध्ये दुसरी वेळ बुक करा.`,
  },
};

export function template(name, lang, data) {
  const t = T[name];
  return (t[lang] || t.en)(data);
}
