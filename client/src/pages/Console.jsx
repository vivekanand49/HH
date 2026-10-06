// Hospital emergency desk / 108 dispatch: live queue of alerts from every
// channel (app, SMS, missed call), most urgent first.
import { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { SYMPTOMS } from '@swasthya/shared/triage';
import Icon from '../components/Icon';
import { ErrorNote, Loading, PageTitle } from '../components/ui';
import { api, fileUrl } from '../lib/api';
import { pick } from '../lib/labels';
import { getSocket } from '../lib/socket';
import { formatDateTime } from '../i18n';

const SEV = {
  critical: 'bg-sos text-white',
  high: 'bg-urgent text-white',
  unknown: 'bg-ink text-white',
  medium: 'bg-warn-soft text-warn',
  low: 'bg-leaf-soft text-leaf-dark',
};
const BAR = { critical: 'bg-sos', high: 'bg-urgent', unknown: 'bg-ink', medium: 'bg-warn', low: 'bg-leaf' };
const CHANNEL = { app: 'App', sms: 'SMS', missed_call: 'Missed call', voice: 'Voice message', staff: 'Staff' };

function age(dob) {
  if (!dob) return null;
  return Math.floor((Date.now() - new Date(dob)) / (365.25 * 24 * 3600 * 1000));
}

export default function Console() {
  const { t } = useTranslation();
  const user = useSelector((s) => s.session.user);
  const [alerts, setAlerts] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [ambulances, setAmbulances] = useState([]);
  const [error, setError] = useState(null);
  const [voiceSrc, setVoiceSrc] = useState(null);

  const load = useCallback(async () => {
    try {
      const [a, amb] = await Promise.all([api('/emergency/alerts'), api('/emergency/ambulances')]);
      setAlerts(a.alerts);
      setAmbulances(amb.ambulances);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
    const socket = getSocket();
    socket?.on('alert:new', load);
    socket?.on('alert:update', load);
    return () => {
      socket?.off('alert:new', load);
      socket?.off('alert:update', load);
    };
  }, [load]);

  useEffect(() => {
    setVoiceSrc(null);
    if (!selected) return setDetail(null);
    api(`/emergency/alerts/${selected}`).then(setDetail, setError);
  }, [selected, alerts]);

  async function act(path, body) {
    try {
      await api(`/emergency/alerts/${selected}/${path}`, { method: 'POST', body });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  const a = detail?.alert;
  const med = detail?.medical;

  return (
    <div>
      <PageTitle title={t('Emergency desk')} subtitle={`${user.full_name} · ${t('{{n}} open alerts', { n: alerts?.length ?? 0 })}`} />
      <ErrorNote error={error} onRetry={load} />
      {!alerts && !error && <Loading />}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <ul className="flex flex-col gap-3" aria-label={t('Incoming alerts')}>
          {alerts?.length === 0 && <li className="card p-5 text-muted">{t('No open alerts.')}</li>}
          {alerts?.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                aria-pressed={selected === x.id}
                onClick={() => setSelected(x.id)}
                className={`flex w-full gap-3 rounded-2xl border bg-surface p-4 text-left ${selected === x.id ? 'border-2 border-brand' : 'border-line'} ${x.acknowledged_at ? 'opacity-70' : ''}`}
              >
                <span className={`w-1.5 shrink-0 self-stretch rounded-full ${BAR[x.severity]}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex justify-between gap-2">
                    <span className="font-bold">{x.patient_name ?? x.phone ?? t('Unknown caller')}</span>
                    <span className="text-sm whitespace-nowrap text-muted">{formatDateTime(x.created_at, { hour: 'numeric', minute: '2-digit' })}</span>
                  </span>
                  <span className="block text-sm">{x.symptoms.map((c) => pick(SYMPTOMS[c]?.label)).join(', ') || t('No details yet')}</span>
                  <span className="mt-1.5 flex flex-wrap gap-1.5 text-xs font-bold">
                    <span className={`rounded-md px-2 py-0.5 uppercase ${SEV[x.severity]}`}>{t(`severity_${x.severity}`)}</span>
                    <span className="rounded-md bg-line-soft px-2 py-0.5">{t(CHANNEL[x.channel])}</span>
                    <span className="rounded-md bg-line-soft px-2 py-0.5">{t(`status_${x.status}`)}</span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        {a ? (
          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold">{a.patient_name ?? t('Unknown caller')}</h2>
                <p className="text-muted">
                  {[a.gender && t(a.gender), age(a.date_of_birth) && t('{{n}} yrs', { n: age(a.date_of_birth) }), a.phone].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className={`rounded-lg px-3 py-1.5 font-bold uppercase ${SEV[a.severity]}`}>{t(`severity_${a.severity}`)}</span>
            </div>
            <p className="card p-3.5 text-[15px]">
              <strong>{t('Received via {{c}}', { c: t(CHANNEL[a.channel]) })}</strong> · {formatDateTime(a.created_at)}
              {!a.patient_id && (
                <span className="mt-1 block text-sm font-semibold text-warn">
                  {t('Sender not signed in: phone number not verified. Call back to confirm.')}
                </span>
              )}
              {a.note && <span className="mt-1 block text-sm text-muted">{a.note}</span>}
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="card flex flex-col gap-2 p-4">
                <h3 className="text-sm font-bold tracking-wide text-muted uppercase">{t('What the patient sent')}</h3>
                <p>{a.symptoms.map((c) => pick(SYMPTOMS[c]?.label)).join(', ') || t('No details yet')}</p>
                {a.note && <p>{a.note}</p>}
                {a.raw_message && <p className="rounded-lg bg-bg p-2.5 font-mono text-sm break-all">{a.raw_message}</p>}
                {a.voice_transcript && (
                  <div className="rounded-lg bg-accent-soft p-2.5 text-[15px]">
                    <p className="text-xs font-bold text-accent uppercase">{t('Voice message (transcribed)')}</p>
                    <p lang={a.voice_language}>{a.voice_transcript}</p>
                    {a.voice_transcript_en && <p className="mt-1 text-sm text-muted">{a.voice_transcript_en}</p>}
                  </div>
                )}
                {a.voice_file_id &&
                  (voiceSrc ? (
                    <audio src={voiceSrc} controls autoPlay className="w-full" />
                  ) : (
                    <button type="button" className="btn-outline min-h-11" onClick={() => fileUrl(a.voice_file_id).then(setVoiceSrc, setError)}>
                      <Icon name="speaker" size={18} /> {t('Play voice message')}
                    </button>
                  ))}
              </div>
              <div className="card flex flex-col gap-2 p-4 text-[15px]">
                <h3 className="text-sm font-bold tracking-wide text-muted uppercase">{t('Medical summary')}</h3>
                <p>
                  {t('Blood group')}: <strong>{a.blood_group ?? '—'}</strong>
                </p>
                <p>
                  {t('Allergies')}: <strong className="text-sos-dark">{med?.allergies.join(', ') || '—'}</strong>
                </p>
                <p>
                  {t('Conditions')}: <strong>{med?.conditions.join(', ') || '—'}</strong>
                </p>
                <p>
                  {t('Medicines')}: <strong>{med?.medications.join(', ') || '—'}</strong>
                </p>
              </div>
            </div>

            <div className="card flex flex-wrap items-center gap-3 p-4">
              <span className="flex-1">
                <strong>{a.lat != null ? `${a.lat.toFixed(4)}, ${a.lng.toFixed(4)}` : t('Location unknown')}</strong>
                <span className="block text-sm text-muted">{a.location_source && t(`loc_${a.location_source}`)}</span>
              </span>
              {a.lat != null && (
                <a className="btn-outline min-h-11" href={`https://www.google.com/maps?q=${a.lat},${a.lng}`} target="_blank" rel="noreferrer">
                  {t('Open map')}
                </a>
              )}
            </div>

            <div className="card flex flex-col gap-3 p-4">
              <p>
                {a.ambulance_registration
                  ? t('Ambulance {{reg}} · driver {{d}}', { reg: a.ambulance_registration, d: a.driver_name })
                  : t('No ambulance assigned yet')}
              </p>
              {!a.ambulance_registration && (
                <div className="flex flex-wrap gap-2">
                  {ambulances
                    .filter((x) => x.status === 'free')
                    .map((x) => (
                      <button key={x.id} type="button" className="btn-outline min-h-11" onClick={() => act('dispatch', { ambulanceId: x.id })}>
                        {t('Send')} {x.registration}
                      </button>
                    ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              {!a.acknowledged_at && (
                <button type="button" className="btn-primary" onClick={() => act('ack')}>
                  {t('Acknowledge (sends SMS to patient)')}
                </button>
              )}
              {a.phone && (
                <a className="btn-outline" href={`tel:${a.phone}`}>
                  {t('Call patient')}
                </a>
              )}
              <button type="button" className="btn-outline" onClick={() => act('resolve')}>
                {t('Mark resolved')}
              </button>
            </div>
          </section>
        ) : (
          alerts?.length > 0 && <p className="card hidden p-8 text-center text-muted lg:block">{t('Select an alert to see details.')}</p>
        )}
      </div>
    </div>
  );
}
