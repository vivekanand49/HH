// Doctor app: this week's patients, patient summary, join video, prescribe.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Icon from '../components/Icon';
import { ErrorNote, Loading, PageTitle } from '../components/ui';
import { api, useCachedApi } from '../lib/api';
import { formatDateTime } from '../i18n';

const SLOTS = [
  ['08:00', 'Morning'],
  ['14:00', 'Afternoon'],
  ['20:00', 'Night'],
];
const emptyMed = () => ({ name: '', dose: '', times: ['08:00'], days: 5, instructions: '' });

function age(dob) {
  return dob ? Math.floor((Date.now() - new Date(dob)) / (365.25 * 24 * 3600 * 1000)) : null;
}

export default function Doctor() {
  const { t } = useTranslation();
  const list = useCachedApi('/doctor/appointments');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setDetail(null);
    if (selected) api(`/doctor/appointments/${selected}`).then(setDetail, setError);
  }, [selected]);

  const appts = list.data?.appointments ?? [];
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const isToday = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === today;

  return (
    <div>
      <PageTitle
        title={t('My patients')}
        subtitle={t('{{n}} appointments today', { n: appts.filter((a) => isToday(a.starts_at) && a.status === 'confirmed').length })}
      />
      <ErrorNote error={list.error || error} onRetry={list.reload} />
      {list.loading && !list.data && <Loading />}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        <ul className="flex flex-col gap-2.5">
          {list.data && appts.length === 0 && <li className="card p-5 text-muted">{t('No appointments this week.')}</li>}
          {appts.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                aria-pressed={selected === a.id}
                onClick={() => setSelected(a.id)}
                className={`flex w-full items-center gap-3 rounded-2xl border bg-surface p-3.5 text-left shadow-card ${selected === a.id ? 'border-2 border-brand' : 'border-line'} ${a.status === 'completed' ? 'opacity-60' : ''}`}
              >
                <span className="w-16 shrink-0 text-center">
                  <span className="block text-xs font-bold text-muted uppercase">
                    {isToday(a.starts_at) ? t('Today') : formatDateTime(a.starts_at, { weekday: 'short' })}
                  </span>
                  <span className="block font-bold">{formatDateTime(a.starts_at, { hour: 'numeric', minute: '2-digit' })}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{a.patient_name ?? t('Patient')}</span>
                  <span className="block truncate text-sm text-muted">{a.chief_complaint || t('No complaint noted')}</span>
                </span>
                <span className={`rounded-lg px-2 py-1 text-xs font-bold ${a.visit_type === 'video' ? 'bg-accent-soft text-accent' : 'bg-line-soft'}`}>
                  {a.status === 'completed' ? t('Done') : a.visit_type === 'video' ? t('Video') : a.token}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {selected && !detail && <Loading />}
        {detail && (
          <Visit
            key={detail.appointment.id}
            detail={detail}
            onDone={() => {
              list.reload();
              setSelected(null);
            }}
          />
        )}
        {!selected && appts.length > 0 && <p className="card hidden p-8 text-center text-muted lg:block">{t('Select a patient to see details.')}</p>}
      </div>
    </div>
  );
}

function Visit({ detail, onDone }) {
  const { t } = useTranslation();
  const a = detail.appointment;
  const [diagnosis, setDiagnosis] = useState('');
  const [advice, setAdvice] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [meds, setMeds] = useState([emptyMed()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const setMed = (i, patch) => setMeds((m) => m.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const toggleTime = (i, time) =>
    setMeds((m) => m.map((x, j) => (j === i ? { ...x, times: x.times.includes(time) ? x.times.filter((y) => y !== time) : [...x.times, time].sort() } : x)));

  async function complete(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/doctor/appointments/${a.id}/complete`, {
        method: 'POST',
        body: {
          diagnosis,
          advice: advice || undefined,
          followUpDays: followUp ? Number(followUp) : undefined,
          medicines: meds
            .filter((m) => m.name.trim())
            .map((m) => ({ name: m.name, dose: m.dose || undefined, times: m.times, days: Number(m.days) || 1, instructions: m.instructions || undefined })),
        },
      });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{a.patient_name}</h2>
          <p className="text-muted">
            {[a.gender && t(a.gender), age(a.date_of_birth) && t('{{n}} yrs', { n: age(a.date_of_birth) }), a.blood_group].filter(Boolean).join(' · ')}
          </p>
        </div>
        {a.visit_type === 'video' && a.status === 'confirmed' && (
          <Link to={`/consult/${a.id}`} className="btn-primary">
            <Icon name="video" /> {t('Start video call')}
          </Link>
        )}
      </div>

      {detail.allergies.length > 0 && (
        <p className="flex items-center gap-2 rounded-2xl bg-sos-soft p-3.5 font-semibold text-sos-dark">
          <Icon name="alert" /> {t('Allergy')}: {detail.allergies.join(', ')}
        </p>
      )}

      <div className="card p-4">
        <p className="text-sm font-bold text-muted uppercase">{t('Reason for visit')}</p>
        <p className="mt-1">{a.chief_complaint || t('No complaint noted')}</p>
      </div>

      {detail.consent ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card p-4 text-[15px]">
            <p className="mb-1 text-sm font-bold text-muted uppercase">{t('Conditions')}</p>
            <p>{detail.conditions.map((c) => c.name).join(', ') || '—'}</p>
            <p className="mt-3 mb-1 text-sm font-bold text-muted uppercase">{t('Medicines')}</p>
            <p>{detail.medications.map((m) => `${m.name} ${m.dose ?? ''}`.trim()).join(', ') || '—'}</p>
          </div>
          <div className="card p-4 text-[15px]">
            {detail.vitals?.length > 0 && (
              <>
                <p className="mb-1 text-sm font-bold text-muted uppercase">{t('Latest readings')}</p>
                <p className="mb-3">
                  {(() => {
                    const v = detail.vitals[0];
                    return [
                      v.systolic && `BP ${v.systolic}/${v.diastolic}`,
                      v.sugar_mgdl && `${t('Sugar')} ${v.sugar_mgdl}`,
                      v.weight_kg && `${v.weight_kg} kg`,
                      v.spo2 && `SpO₂ ${v.spo2}%`,
                    ]
                      .filter(Boolean)
                      .join(' · ');
                  })()}{' '}
                  <span className="text-sm text-muted">· {formatDateTime(detail.vitals[0].recorded_at, { day: 'numeric', month: 'short' })}</span>
                </p>
              </>
            )}
            <p className="mb-1 text-sm font-bold text-muted uppercase">{t('Recent records')}</p>
            <ul className="space-y-1.5">
              {detail.records.slice(0, 5).map((r, i) => (
                <li key={i}>
                  <span className="font-semibold">{r.title}</span> <span className="text-muted">· {r.summary?.split('\n')[0]}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <p className="card p-4 text-muted">{t('The patient has not shared their health history. Allergies are always shown.')}</p>
      )}

      {a.status === 'completed' ? (
        <p className="rounded-2xl bg-leaf-soft p-4 text-leaf-dark">
          {t('Visit completed')}: {a.diagnosis}
        </p>
      ) : (
        <form onSubmit={complete} className="card flex flex-col gap-4 p-4">
          <h3 className="text-lg font-bold">{t('Diagnosis and prescription')}</h3>
          <label className="flex flex-col gap-1.5">
            <span className="label">{t('Diagnosis')}</span>
            <input className="input" value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} required minLength={2} maxLength={300} />
          </label>

          {meds.map((m, i) => (
            <fieldset key={i} className="flex flex-col gap-3 rounded-2xl border border-line p-3">
              <legend className="px-1 text-sm font-bold text-muted">
                {t('Medicine')} {i + 1}
              </legend>
              <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
                <input
                  className="input"
                  placeholder={t('Name')}
                  aria-label={t('Medicine name')}
                  value={m.name}
                  onChange={(e) => setMed(i, { name: e.target.value })}
                />
                <input
                  className="input"
                  placeholder={t('Dose, e.g. 500 mg')}
                  aria-label={t('Dose')}
                  value={m.dose}
                  onChange={(e) => setMed(i, { dose: e.target.value })}
                />
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={365}
                  aria-label={t('Days')}
                  value={m.days}
                  onChange={(e) => setMed(i, { days: e.target.value })}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {SLOTS.map(([time, label]) => (
                  <button
                    key={time}
                    type="button"
                    aria-pressed={m.times.includes(time)}
                    onClick={() => toggleTime(i, time)}
                    className={`chip ${m.times.includes(time) ? 'border-brand bg-brand text-white' : ''}`}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
              <input
                className="input"
                placeholder={t('Instructions, e.g. after food')}
                aria-label={t('Instructions')}
                value={m.instructions}
                onChange={(e) => setMed(i, { instructions: e.target.value })}
              />
            </fieldset>
          ))}
          <button type="button" className="btn-outline self-start" onClick={() => setMeds((x) => [...x, emptyMed()])}>
            + {t('Add medicine')}
          </button>

          <label className="flex flex-col gap-1.5">
            <span className="label">{t('Advice (optional)')}</span>
            <textarea className="input min-h-20 py-3 text-base" value={advice} onChange={(e) => setAdvice(e.target.value)} maxLength={1000} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label">{t('Follow-up after (days, optional)')}</span>
            <input className="input" type="number" min={1} max={365} value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
          </label>
          <ErrorNote error={error} />
          <button type="submit" className="btn-primary min-h-14 text-lg" disabled={busy || diagnosis.trim().length < 2}>
            {busy ? t('Saving…') : t('Complete visit and send prescription')}
          </button>
          <p className="text-sm text-muted">{t('The patient gets an SMS, and the medicines appear in their app with reminders.')}</p>
        </form>
      )}
    </section>
  );
}
