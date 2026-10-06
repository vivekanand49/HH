// Emergency: never needs sign-in, and degrades step by step:
//   internet → alert goes to the server (108, nearest ER, family) in seconds
//   no internet, phone signal → one tap opens a ready-made SOS SMS / missed call
//   no signal → Call 112 / 108 (works on any operator), offline first aid,
//               and the alert waits in the outbox until any signal returns
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { EMERGENCY_CODES, SYMPTOMS, severityFromCodes } from '@swasthya/shared/triage';
import { encodeSosSms, smsHref } from '@swasthya/shared/sms';
import Icon from '../components/Icon';
import { ErrorNote } from '../components/ui';
import { FamilySwitcher } from '../components/Family';
import { api, useCachedApi } from '../lib/api';
import { getLocation } from '../lib/location';
import { newClientRef, sendAlert, sendVoice } from '../lib/emergency';
import { FIRST_AID, pick } from '../lib/labels';
import { getSocket } from '../lib/socket';
import { formatDateTime } from '../i18n';
import { selectActive } from '../store';

const FALLBACK_NUMBERS = {
  smsGatewayNumber: import.meta.env.VITE_SMS_GATEWAY_NUMBER || '+910000000000',
  missedCallNumber: import.meta.env.VITE_MISSED_CALL_NUMBER || '+910000000001',
};

export default function Emergency() {
  const { t, i18n } = useTranslation();
  const online = useSelector((s) => s.network.online);
  const user = useSelector(selectActive); // a family member, if this phone is acting for one
  const cfg = useCachedApi('/emergency/config');
  const numbers = { ...FALLBACK_NUMBERS, ...cfg.data };

  const [codes, setCodes] = useState([]);
  const [loc, setLoc] = useState(null);
  const [locating, setLocating] = useState(true);
  const [phone, setPhone] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | sending | sent | queued
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [clientRef] = useState(newClientRef);
  const [voiceStatus, setVoiceStatus] = useState(null); // null | 'sending' | 'sent' | 'queued'

  const nearPath = loc ? `/hospitals?emergency=1&lat=${loc.lat.toFixed(3)}&lng=${loc.lng.toFixed(3)}` : '/hospitals?emergency=1';
  const nearby = useCachedApi(nearPath);

  useEffect(() => {
    getLocation({ timeout: 12000, maxAge: 30000 }).then((l) => {
      setLoc(l);
      setLocating(false);
    });
  }, []);

  // Live updates (ambulance assigned, hospital acknowledged) for signed-in users.
  useEffect(() => {
    const socket = user && getSocket();
    if (!socket || !result?.alert) return;
    const onUpdate = (a) => a.id === result.alert.id && setResult((r) => ({ ...r, alert: a }));
    socket.on('alert:update', onUpdate);
    return () => socket.off('alert:update', onUpdate);
  }, [user, result?.alert?.id]);

  const severity = severityFromCodes(codes) || 'high';
  const smsBody = useMemo(
    () => encodeSosSms({ sosCode: user?.sos_code, lat: loc?.lat, lng: loc?.lng, codes, severity }),
    [user?.sos_code, loc, codes, severity],
  );

  const toggle = (c) => setCodes((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  // Returns true when the alert reached the server.
  async function send() {
    setError(null);
    if (!user && phone.replace(/\D/g, '').length < 10) {
      setError(new Error(t('Enter your mobile number so help can call you back.')));
      return false;
    }
    setPhase('sending');
    const payload = {
      clientRef,
      symptoms: codes,
      ...(loc ? { lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy } : {}),
      ...(!user ? { phone } : {}),
    };
    try {
      setResult(await sendAlert(payload));
      setPhase('sent');
      return true;
    } catch (err) {
      if (err.status === 0) setPhase('queued');
      else {
        setError(err);
        setPhase('idle');
      }
      return false;
    }
  }

  // A voice message rides on the alert: if no alert exists yet, create one.
  async function attachVoice(blob) {
    let alertSent = phase === 'sent';
    if (phase === 'idle') {
      alertSent = await send();
      if (!alertSent && !user && phone.replace(/\D/g, '').length < 10) return;
    }
    setVoiceStatus('sending');
    try {
      const { queued } = await sendVoice(clientRef, blob, { alertSent, lang: i18n.language });
      setVoiceStatus(queued ? 'queued' : 'sent');
    } catch (err) {
      setError(err);
      setVoiceStatus(null);
    }
  }

  async function cancel() {
    if (!window.confirm(t('Cancel the alert? Only do this if you are safe.'))) return;
    try {
      const res = await api(`/emergency/alerts/${result.alert.id}/cancel`, { method: 'POST' });
      setResult((r) => ({ ...r, alert: res.alert }));
    } catch (err) {
      setError(err);
    }
  }

  const status = !online
    ? { tone: 'bg-warn-soft text-warn', title: t('No internet'), text: t('SMS and calls may still work. Use the buttons below.') }
    : { tone: 'bg-leaf-soft text-leaf-dark', title: t('Connected'), text: t('Your alert reaches 108 and the nearest hospital in seconds. Slow 2G is enough.') };

  const a = result?.alert;
  const smsLink = smsHref(numbers.smsGatewayNumber, smsBody);

  return (
    <div className="min-h-dvh bg-sos-bg">
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 pt-4 pb-10 md:pt-8">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-sos-dark">{t('Emergency')}</h1>
          <Link to={user ? '/' : '/login'} aria-label={t('Close')} className="grid size-11 place-items-center rounded-full border border-sos-line bg-surface">
            <Icon name="close" />
          </Link>
        </div>

        <div role="status" className={`rounded-2xl p-4 ${status.tone}`}>
          <p className="font-bold">{status.title}</p>
          <p className="text-[15px]">{status.text}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <a href="tel:108" className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-3xl bg-sos text-white hover:bg-sos-dark">
            <Icon name="ambulance" size={28} />
            <span className="text-xl font-bold">{t('Call 108')}</span>
            <span className="text-xs">{t('Ambulance')}</span>
          </a>
          <a href="tel:112" className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-3xl border-2 border-sos bg-surface text-sos-dark">
            <Icon name="phone" size={26} />
            <span className="text-xl font-bold">{t('Call 112')}</span>
            <span className="text-xs">{t('Works on any network')}</span>
          </a>
        </div>

        {phase !== 'sent' && (
          <>
            {/* Family phone: the alert, SOS code and medical details are for whoever is picked here. */}
            {phase === 'idle' && <FamilySwitcher label={t('Who needs help?')} />}
            <fieldset>
              <legend className="mb-2 font-bold">
                {t('What is happening?')} <span className="font-normal text-muted">{t('Tap all that apply')}</span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {EMERGENCY_CODES.map((c) => {
                  const on = codes.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(c)}
                      className={`min-h-12 rounded-full px-4 text-[15px] font-semibold ${on ? 'bg-sos text-white' : 'border border-sos-line bg-surface'}`}
                    >
                      {pick(SYMPTOMS[c].label)}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="flex items-center gap-3 rounded-2xl border border-sos-line bg-surface p-3.5">
              <Icon name="pin" className="text-sos" />
              <div className="min-w-0 text-[15px]">
                {locating ? (
                  <p>{t('Finding your location…')}</p>
                ) : loc ? (
                  <>
                    <p className="font-semibold">
                      {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                      {loc.accuracy ? ` · ±${loc.accuracy} m` : ''}
                    </p>
                    <p className="text-sm text-muted">{loc.source === 'last_known' ? t('Last known location') : t('GPS works without internet')}</p>
                  </>
                ) : (
                  <p>{t('Location is off. Turn on location, or say where you are when they call.')}</p>
                )}
              </div>
            </div>

            {!user && (
              <label className="flex flex-col gap-1.5">
                <span className="label">{t('Your mobile number')}</span>
                <input
                  className="input"
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
            )}
          </>
        )}

        <ErrorNote error={error} />

        {online && (phase === 'idle' || phase === 'sending') && (
          <div className="flex flex-col gap-2">
            <button type="button" className="btn-sos min-h-16 text-xl" onClick={send} disabled={phase === 'sending'}>
              {phase === 'sending' ? t('Sending…') : t('Send alert now')}
            </button>
            <p className="text-center text-sm text-muted">{t('Goes to 108, the nearest emergency hospital and your family contact.')}</p>
          </div>
        )}

        {phase === 'sent' && a && (
          <section className="rounded-3xl border border-sos-line bg-surface p-5" aria-live="polite">
            <h2 className="mb-3 text-xl font-bold">{a.status === 'cancelled' ? t('Alert cancelled') : t('Help is on the way')}</h2>
            <ol className="flex flex-col gap-3 text-[15px]">
              <Step done title={t('Alert received')} detail={formatDateTime(a.created_at, { hour: 'numeric', minute: '2-digit', second: '2-digit' })} />
              {a.hospital_name && (
                <Step
                  done={Boolean(a.acknowledged_at)}
                  title={t('{{h}} notified', { h: a.hospital_name })}
                  detail={a.acknowledged_at ? t('They have seen your alert') : t('Waiting for them to confirm')}
                />
              )}
              {a.ambulance_registration ? (
                <Step
                  done
                  title={t('Ambulance {{reg}} on the way', { reg: a.ambulance_registration })}
                  detail={[
                    result.ambulance?.eta_min && t('About {{n}} min', { n: result.ambulance.eta_min }),
                    a.driver_name && `${t('Driver')} ${a.driver_name}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  action={
                    a.driver_phone && (
                      <a className="font-semibold text-brand underline" href={`tel:${a.driver_phone}`}>
                        {t('Call driver')}
                      </a>
                    )
                  }
                />
              ) : (
                <Step title={t('Finding the nearest ambulance')} detail={t('Also call 108 if you can.')} />
              )}
              {a.emergency_contact_name && <Step done title={t('{{name}} informed by SMS', { name: a.emergency_contact_name })} />}
            </ol>
            {a.status !== 'cancelled' && a.status !== 'resolved' && user && (
              <button type="button" className="btn-outline mt-4 w-full" onClick={cancel}>
                {t('Cancel alert (I am safe)')}
              </button>
            )}
          </section>
        )}

        {(!online || phase === 'queued') && (
          <section className="flex flex-col gap-3">
            {phase === 'queued' && (
              <p className="rounded-2xl bg-warn-soft p-3.5 text-[15px] text-warn">
                <strong>{t('Alert saved on your phone.')}</strong> {t('It sends by itself as soon as the internet comes back. Send an SMS too:')}
              </p>
            )}
            <a href={smsLink} className="btn-sos min-h-16 text-xl">
              <Icon name="sms" size={24} /> {t('Send SMS alert')}
            </a>
            <p className="text-sm text-muted">{t('Opens your SMS app with this message ready. Just press Send:')}</p>
            <p className="rounded-2xl border border-sos-line bg-surface p-3 font-mono text-sm break-all">{smsBody}</p>
            <a href={`tel:${numbers.missedCallNumber}`} className="btn min-h-13 border-2 border-sos bg-surface text-sos-dark">
              {t('Give a missed call instead')}
            </a>
            <p className="text-center text-sm text-muted">{t('We recognise your number and call you back.')}</p>
          </section>
        )}

        {a?.status !== 'cancelled' && <VoiceRecorder status={voiceStatus} onDone={attachVoice} disabled={phase === 'sending'} />}

        <section>
          <h2 className="mb-2 font-bold">
            {t('Nearest emergency hospitals')} <span className="font-normal text-muted">· {t('saved offline')}</span>
          </h2>
          <ul className="divide-y divide-sos-line overflow-hidden rounded-2xl border border-sos-line bg-surface">
            {(nearby.data?.hospitals ?? []).slice(0, 3).map((h) => (
              <li key={h.id} className="flex items-center gap-3 p-3.5">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{h.name}</span>
                  <span className="text-sm text-muted">
                    {h.distance_km} km · {h.type === 'government' ? t('Government') : t('Private')}
                  </span>
                </span>
                {h.emergency_phone && (
                  <a
                    href={`tel:${h.emergency_phone}`}
                    aria-label={`${t('Call')} ${h.name}`}
                    className="grid size-11 place-items-center rounded-xl bg-sos-soft text-sos-dark"
                  >
                    <Icon name="phone" size={20} />
                  </a>
                )}
              </li>
            ))}
            {!nearby.data && <li className="p-3.5 text-muted">{t('Open the app once with internet to save nearby hospitals.')}</li>}
          </ul>
        </section>

        <section>
          <h2 className="mb-2 font-bold">
            {t('While you wait')} <span className="font-normal text-muted">· {t('works offline')}</span>
          </h2>
          <div className="flex flex-col gap-2">
            {FIRST_AID.map((f) => (
              <details key={f.id} className="group rounded-2xl border border-sos-line bg-surface">
                <summary className="flex min-h-13 cursor-pointer list-none items-center justify-between px-4 font-semibold">
                  {pick(f.title)} <Icon name="right" size={18} className="transition-transform group-open:rotate-90" />
                </summary>
                <ol className="list-decimal space-y-1.5 px-9 pb-4 text-[15px]">
                  {pick(f.steps).map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </details>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function Step({ done = false, title, detail, action }) {
  return (
    <li className="flex gap-3">
      <span className={`mt-1 size-3.5 shrink-0 rounded-full ${done ? 'bg-leaf-dark' : 'border-2 border-muted/50'}`} />
      <span>
        <span className="block font-semibold">{title}</span>
        {detail && <span className="block text-sm text-muted">{detail}</span>}
        {action}
      </span>
    </li>
  );
}

const MAX_SECONDS = 60;

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return '';
}

// Hold a short voice message on the phone. Works offline: it is saved and
// sent with the alert when any connection returns.
function VoiceRecorder({ status, onDone, disabled }) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState(null);
  const rec = useRef(null);
  const timer = useRef(null);
  const mime = pickMime();

  useEffect(
    () => () => {
      clearInterval(timer.current);
      rec.current?.stream.getTracks().forEach((tr) => tr.stop());
    },
    [],
  );

  if (mime === null) return null; // browser can't record audio

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : undefined);
      const chunks = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        clearInterval(timer.current);
        setRecording(false);
        const type = (recorder.mimeType || mime || 'audio/webm').split(';')[0];
        if (chunks.length) onDone(new Blob(chunks, { type }));
      };
      rec.current = recorder;
      recorder.start();
      setSeconds(0);
      setRecording(true);
      timer.current = setInterval(() => {
        setSeconds((n) => {
          if (n + 1 >= MAX_SECONDS) recorder.state === 'recording' && recorder.stop();
          return n + 1;
        });
      }, 1000);
    } catch {
      setError(t('Microphone permission is needed to record.'));
    }
  }

  const stop = () => rec.current?.state === 'recording' && rec.current.stop();

  if (status === 'sent' || status === 'queued') {
    return (
      <p role="status" className={`rounded-2xl p-3.5 text-[15px] ${status === 'sent' ? 'bg-leaf-soft text-leaf-dark' : 'bg-warn-soft text-warn'}`}>
        {status === 'sent' ? t('Voice message sent to the hospital.') : t('Voice message saved. It will be sent when the internet comes back.')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={disabled || status === 'sending'}
        onClick={recording ? stop : start}
        className={`btn min-h-14 border-2 ${recording ? 'border-sos bg-sos text-white' : 'border-sos-line bg-surface text-ink'}`}
      >
        <Icon name="mic" />
        {status === 'sending'
          ? t('Sending voice message…')
          : recording
            ? t('Stop and send ({{s}}s)', { s: MAX_SECONDS - seconds })
            : t('Record a voice message')}
      </button>
      <p className="text-center text-sm text-muted">{error || t('Say what happened and where you are. Up to 1 minute.')}</p>
    </div>
  );
}
