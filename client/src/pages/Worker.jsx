// ASHA / health-worker mode: villagers I registered, home-visit readings,
// emergencies and bookings on their behalf. Everything works offline and
// syncs when the phone gets signal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { EMERGENCY_CODES, SYMPTOMS } from '@swasthya/shared/triage';
import { encodeSosSms, smsHref } from '@swasthya/shared/sms';
import { flagVitals, FLAG_TEXT } from '@swasthya/shared/vitals';
import Icon from '../components/Icon';
import { ChoiceCard, ErrorNote, Loading, PageTitle, StaleNote } from '../components/ui';
import { useCachedApi } from '../lib/api';
import { discardQueued, flushHwQueue, hwQueueAll, onQueueChange, queueAction } from '../lib/hwQueue';
import { getLocation } from '../lib/location';
import { pick } from '../lib/labels';
import { formatDateTime, LANGUAGES } from '../i18n';

function useQueue() {
  const [items, setItems] = useState([]);
  const load = useCallback(() => hwQueueAll().then(setItems), []);
  useEffect(() => {
    load();
    return onQueueChange(load);
  }, [load]);
  return items;
}

const age = (dob) => (dob ? Math.floor((Date.now() - new Date(dob)) / (365.25 * 24 * 3600 * 1000)) : null);

export default function Worker() {
  const { t } = useTranslation();
  const online = useSelector((s) => s.network.online);
  const me = useSelector((s) => s.session.user);
  const list = useCachedApi('/hw/patients');
  const queue = useQueue();
  const [q, setQ] = useState('');
  const [view, setView] = useState(null); // null | 'register' | { id } | { ref }
  const [syncing, setSyncing] = useState(false);

  async function sync() {
    setSyncing(true);
    await flushHwQueue();
    setSyncing(false);
    list.reload();
  }
  useEffect(() => {
    if (online && queue.some((x) => !x.error)) sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, queue.length]);

  const pendingPeople = queue.filter((x) => x.kind === 'register');
  const people = useMemo(() => {
    const synced = list.data?.patients ?? [];
    const term = q.trim().toLowerCase();
    return synced.filter((p) => !term || `${p.full_name} ${p.village ?? ''}`.toLowerCase().includes(term));
  }, [list.data, q]);

  const waiting = queue.filter((x) => !x.error).length;
  const failed = queue.filter((x) => x.error);

  return (
    <div>
      <PageTitle
        title={t('My villagers')}
        subtitle={me.full_name}
        action={
          <button type="button" className="btn-primary" onClick={() => setView('register')}>
            + {t('Register')}
          </button>
        }
      />

      <div className="hero relative mb-5 flex min-h-32 overflow-hidden rounded-3xl">
        <span className="relative z-10 flex max-w-[60%] flex-col justify-center gap-1 p-5">
          <span className="text-xl leading-tight font-bold">{t('Healthcare for every village')}</span>
          <span className="text-[15px] text-white/90">{t('{{n}} people in your care', { n: list.data?.patients?.length ?? 0 })}</span>
        </span>
        <img
          src="/img/village.jpg"
          alt=""
          width={480}
          height={480}
          loading="lazy"
          className="absolute right-0 bottom-0 h-full w-[45%] object-cover object-top md:w-64 [mask-image:linear-gradient(to_right,transparent,black_35%)]"
        />
      </div>

      {(waiting > 0 || failed.length > 0) && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-warn-soft p-3.5 text-warn">
          <Icon name="clock" />
          <span className="flex-1 text-[15px]">
            {waiting > 0 && t('{{n}} saved on this phone, waiting to send', { n: waiting })}
            {failed.length > 0 && ` · ${t('{{n}} could not be sent', { n: failed.length })}`}
          </span>
          {online && waiting > 0 && (
            <button type="button" className="btn-outline min-h-10" onClick={sync} disabled={syncing}>
              {syncing ? t('Sending…') : t('Send now')}
            </button>
          )}
        </div>
      )}
      {failed.map((f) => (
        <div key={f.clientRef} className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl bg-sos-soft p-3.5 text-sos-dark">
          <span className="flex-1 text-sm">
            <strong>{f.label}</strong>: {f.error}
          </span>
          <button type="button" className="text-sm font-semibold underline" onClick={() => discardQueued(f.clientRef)}>
            {t('Remove')}
          </button>
        </div>
      ))}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className={view ? 'hidden lg:block' : ''}>
          <label className="mb-3 flex min-h-12 items-center gap-2.5 rounded-2xl border border-line bg-surface px-4">
            <Icon name="search" size={18} className="text-muted" />
            <span className="sr-only">{t('Search')}</span>
            <input
              className="flex-1 bg-transparent py-3 outline-none"
              placeholder={t('Search name or village')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <StaleNote stale={list.stale} savedAt={list.savedAt} />
          <ErrorNote error={list.error} onRetry={list.reload} />
          {list.loading && !list.data && <Loading />}
          <ul className="flex flex-col gap-2">
            {pendingPeople.map((p) => (
              <li key={p.clientRef}>
                <ChoiceCard selected={view?.ref === p.clientRef} onClick={() => setView({ ref: p.clientRef })}>
                  <span className="flex justify-between gap-2">
                    <span className="font-semibold">{p.body.full_name}</span>
                    <span className="rounded-md bg-warn-soft px-2 py-0.5 text-xs font-bold text-warn">{t('Not sent yet')}</span>
                  </span>
                  <span className="text-sm text-muted">{p.body.village}</span>
                </ChoiceCard>
              </li>
            ))}
            {people.map((p) => (
              <li key={p.id}>
                <ChoiceCard selected={view?.id === p.id} onClick={() => setView({ id: p.id })}>
                  <span className="flex justify-between gap-2">
                    <span className="font-semibold">{p.full_name}</span>
                    <span className="text-sm text-muted">
                      {[p.gender && t(p.gender), age(p.date_of_birth) && t('{{n}} yrs', { n: age(p.date_of_birth) })].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="text-sm text-muted">
                    {p.village} ·{' '}
                    {p.last_visit ? t('Last visit {{when}}', { when: formatDateTime(p.last_visit, { day: 'numeric', month: 'short' }) }) : t('No visits yet')}
                  </span>
                </ChoiceCard>
              </li>
            ))}
            {list.data && people.length === 0 && pendingPeople.length === 0 && <li className="card p-5 text-muted">{t('No one registered yet.')}</li>}
          </ul>
        </div>

        {view && (
          <div>
            <button type="button" className="btn-outline mb-4 min-h-11 lg:hidden" onClick={() => setView(null)}>
              <Icon name="left" size={18} /> {t('Back to list')}
            </button>
            {view === 'register' && <Register me={me} onDone={(ref) => setView({ ref })} />}
            {view.id && <Person key={view.id} id={view.id} />}
            {view.ref && <QueuedPerson key={view.ref} item={pendingPeople.find((p) => p.clientRef === view.ref)} onSynced={() => setView(null)} />}
          </div>
        )}
      </div>
    </div>
  );
}

function Register({ me, onDone }) {
  const { t } = useTranslation();
  const [f, setF] = useState({
    full_name: '',
    gender: 'female',
    age_years: '',
    village: me.village ?? '',
    phone: '',
    language: 'te',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    consent: false,
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function submit(e) {
    e.preventDefault();
    const body = { ...f, age_years: Number(f.age_years) };
    for (const k of ['phone', 'emergency_contact_name', 'emergency_contact_phone']) if (!body[k]) delete body[k];
    const item = await queueAction({ kind: 'register', body, label: f.full_name });
    flushHwQueue();
    onDone(item.clientRef);
  }

  return (
    <form onSubmit={submit} className="card flex flex-col gap-4 p-5">
      <h2 className="text-xl font-bold">{t('Register a person')}</h2>
      <p className="-mt-2 text-sm text-muted">{t('Works without internet. It is sent when the phone gets signal.')}</p>
      <label className="flex flex-col gap-1.5">
        <span className="label">{t('Full name')}</span>
        <input className="input" value={f.full_name} onChange={set('full_name')} required minLength={2} maxLength={120} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="label">{t('Gender')}</span>
          <select className="input" value={f.gender} onChange={set('gender')}>
            <option value="female">{t('female')}</option>
            <option value="male">{t('male')}</option>
            <option value="other">{t('other')}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">{t('Age (years)')}</span>
          <input className="input" type="number" inputMode="numeric" min={0} max={120} value={f.age_years} onChange={set('age_years')} required />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="label">{t('Village')}</span>
        <input className="input" value={f.village} onChange={set('village')} required minLength={2} maxLength={120} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">{t('Mobile number (if any)')}</span>
        <input className="input" inputMode="tel" value={f.phone} onChange={set('phone')} placeholder="98765 43210" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">{t('Language')}</span>
        <select className="input" value={f.language} onChange={set('language')}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.native}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="label">{t('Family contact name')}</span>
          <input className="input" value={f.emergency_contact_name} onChange={set('emergency_contact_name')} maxLength={120} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">{t('Family contact mobile')}</span>
          <input className="input" inputMode="tel" value={f.emergency_contact_phone} onChange={set('emergency_contact_phone')} />
        </label>
      </div>
      <label className="flex items-start gap-3 rounded-2xl border border-line p-4">
        <input type="checkbox" className="mt-1 size-5 shrink-0 accent-brand" checked={f.consent} onChange={set('consent')} required />
        <span className="text-[15px]">
          {t('I explained to the person that their health details will be kept in Swasthya Setu for their care, and they agreed.')}
        </span>
      </label>
      <button type="submit" className="btn-primary min-h-14 text-lg" disabled={!f.consent}>
        {t('Save')}
      </button>
    </form>
  );
}

function QueuedPerson({ item, onSynced }) {
  const { t } = useTranslation();
  // Once the registration syncs it leaves the queue; go back to the list.
  useEffect(() => {
    if (!item) onSynced();
  }, [item, onSynced]);
  if (!item) return null;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-2xl font-bold">{item.body.full_name}</h2>
        <p className="text-muted">
          {item.body.village} · {t('Not sent yet')}
        </p>
      </div>
      <VitalsForm patientRef={item.clientRef} label={item.body.full_name} />
    </div>
  );
}

function Person({ id }) {
  const { t } = useTranslation();
  const online = useSelector((s) => s.network.online);
  const { data, loading, error, stale, savedAt, reload } = useCachedApi(`/hw/patients/${id}`);
  const [sos, setSos] = useState(false);
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNote error={error} onRetry={reload} />;
  const p = data.patient;
  const allergies = data.conditions.filter((c) => c.kind === 'allergy');

  return (
    <div className="flex flex-col gap-4">
      <StaleNote stale={stale} savedAt={savedAt} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{p.full_name}</h2>
          <p className="text-muted">
            {[p.gender && t(p.gender), age(p.date_of_birth) && t('{{n}} yrs', { n: age(p.date_of_birth) }), p.village, p.phone].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-sos" onClick={() => setSos(!sos)}>
            <Icon name="phone" size={18} /> {t('Emergency')}
          </button>
          {online && (
            <Link to={`/book?for=${p.id}&name=${encodeURIComponent(p.full_name)}`} className="btn-outline">
              <Icon name="calendar" size={18} /> {t('Book')}
            </Link>
          )}
        </div>
      </div>

      {sos && <PersonSos patient={p} onDone={() => setSos(false)} />}

      {allergies.length > 0 && (
        <p className="flex items-center gap-2 rounded-2xl bg-sos-soft p-3.5 font-semibold text-sos-dark">
          <Icon name="alert" /> {t('Allergy')}: {allergies.map((a) => a.name).join(', ')}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-4 text-[15px]">
          <p className="mb-1 text-sm font-bold text-muted uppercase">{t('Conditions')}</p>
          <p>
            {data.conditions
              .filter((c) => c.kind === 'condition')
              .map((c) => c.name)
              .join(', ') || '—'}
          </p>
          <p className="mt-3 mb-1 text-sm font-bold text-muted uppercase">{t('Medicines')}</p>
          <p>{data.medications.map((m) => `${m.name} ${m.dose ?? ''} (${m.times.join(', ')})`).join('; ') || '—'}</p>
        </div>
        <div className="card p-4 text-[15px]">
          <p className="mb-1 text-sm font-bold text-muted uppercase">{t('Upcoming visits')}</p>
          {data.appointments.length === 0 && <p>—</p>}
          {data.appointments.map((a) => (
            <p key={a.id}>
              {formatDateTime(a.starts_at)} · {a.doctor_name} · {t('Token')} {a.token}
            </p>
          ))}
        </div>
      </div>

      <VitalsForm patientId={p.id} label={p.full_name} onSaved={reload} />
      <VitalsHistory vitals={data.vitals} />
    </div>
  );
}

const FIELDS = [
  ['systolic', 'BP (upper)', 'mmHg'],
  ['diastolic', 'BP (lower)', 'mmHg'],
  ['pulse', 'Pulse', '/min'],
  ['sugar_mgdl', 'Sugar', 'mg/dL'],
  ['temperature_f', 'Temperature', '°F'],
  ['weight_kg', 'Weight', 'kg'],
  ['spo2', 'Oxygen (SpO₂)', '%'],
];

function VitalsForm({ patientId, patientRef, label, onSaved }) {
  const { t, i18n } = useTranslation();
  const empty = { systolic: '', diastolic: '', pulse: '', sugar_mgdl: '', sugar_type: 'fasting', temperature_f: '', weight_kg: '', spo2: '', notes: '' };
  const [v, setV] = useState(empty);
  const [flags, setFlags] = useState(null);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    const body = { recorded_at: new Date().toISOString() };
    for (const [k] of FIELDS) if (v[k] !== '') body[k] = Number(v[k]);
    if (v.sugar_mgdl !== '') body.sugar_type = v.sugar_type;
    if (v.notes.trim()) body.notes = v.notes.trim();
    if ((body.systolic === undefined) !== (body.diastolic === undefined)) return setError(new Error(t('Enter both BP numbers')));
    if (Object.keys(body).length === 1) return setError(new Error(t('Enter at least one reading')));
    await queueAction({ kind: 'vitals', body, patientId, patientRef, label: `${label} · ${t('readings')}` });
    setFlags(flagVitals(body)); // checked on the phone, so warnings show offline too
    setV(empty);
    await flushHwQueue();
    onSaved?.();
  }

  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });

  return (
    <form onSubmit={submit} className="card flex flex-col gap-4 p-4">
      <h3 className="text-lg font-bold">{t('Home visit readings')}</h3>
      {flags && (
        <div role="status" className={`rounded-2xl p-3.5 ${flags.length ? 'bg-sos-soft text-sos-dark' : 'bg-leaf-soft text-leaf-dark'}`}>
          {flags.length === 0
            ? t('Saved. Readings look OK.')
            : flags.map((f) => (
                <p key={f} className="font-semibold">
                  {FLAG_TEXT[f][i18n.language] ?? FLAG_TEXT[f].en}
                </p>
              ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {FIELDS.map(([k, name, unit]) => (
          <label key={k} className="flex flex-col gap-1">
            <span className="text-sm font-semibold">
              {t(name)} <span className="font-normal text-muted">{unit}</span>
            </span>
            <input
              className="input min-h-12 text-base"
              type="number"
              inputMode="decimal"
              step={k === 'temperature_f' || k === 'weight_kg' ? '0.1' : '1'}
              value={v[k]}
              onChange={set(k)}
            />
          </label>
        ))}
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">{t('Sugar test')}</span>
          <select className="input min-h-12 text-base" value={v.sugar_type} onChange={set('sugar_type')}>
            <option value="fasting">{t('Fasting')}</option>
            <option value="random">{t('Random')}</option>
            <option value="after_meal">{t('After meal')}</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold">{t('Notes (optional)')}</span>
        <input className="input min-h-12 text-base" value={v.notes} onChange={set('notes')} maxLength={500} />
      </label>
      <ErrorNote error={error} />
      <button type="submit" className="btn-primary">
        {t('Save readings')}
      </button>
    </form>
  );
}

function VitalsHistory({ vitals }) {
  const { t } = useTranslation();
  if (!vitals?.length) return null;
  return (
    <div className="card overflow-x-auto p-4">
      <p className="mb-2 text-sm font-bold text-muted uppercase">{t('Past readings')}</p>
      <table className="w-full min-w-[480px] text-left text-[15px]">
        <thead className="text-sm text-muted">
          <tr>
            <th className="py-1.5 font-semibold">{t('Date')}</th>
            <th className="font-semibold">BP</th>
            <th className="font-semibold">{t('Sugar')}</th>
            <th className="font-semibold">{t('Pulse')}</th>
            <th className="font-semibold">{t('Weight')}</th>
          </tr>
        </thead>
        <tbody>
          {vitals.map((v) => {
            const f = flagVitals(v);
            return (
              <tr key={v.id} className="border-t border-line-soft">
                <td className="py-2">{formatDateTime(v.recorded_at, { day: 'numeric', month: 'short' })}</td>
                <td className={f.some((x) => x.startsWith('bp')) ? 'font-bold text-sos-dark' : ''}>{v.systolic ? `${v.systolic}/${v.diastolic}` : '—'}</td>
                <td className={f.some((x) => x.startsWith('sugar')) ? 'font-bold text-sos-dark' : ''}>{v.sugar_mgdl ?? '—'}</td>
                <td>{v.pulse ?? '—'}</td>
                <td>{v.weight_kg ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PersonSos({ patient, onDone }) {
  const { t } = useTranslation();
  const online = useSelector((s) => s.network.online);
  const cfg = useCachedApi('/emergency/config');
  const [codes, setCodes] = useState([]);
  const [loc, setLoc] = useState(null);
  const [state, setState] = useState(null); // null | 'sent' | 'queued'

  useEffect(() => {
    getLocation({ timeout: 10000 }).then(setLoc);
  }, []);

  async function send() {
    await queueAction({
      kind: 'alert',
      patientId: patient.id,
      label: `${patient.full_name} · ${t('Emergency')}`,
      body: { symptoms: codes, ...(loc ? { lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy } : {}) },
    });
    const results = await flushHwQueue();
    setState(results.some((r) => r.item.kind === 'alert') ? 'sent' : 'queued');
  }

  const sms = smsHref(cfg.data?.smsGatewayNumber ?? '+910000000000', encodeSosSms({ sosCode: patient.sos_code, lat: loc?.lat, lng: loc?.lng, codes }));

  return (
    <section className="flex flex-col gap-3 rounded-3xl border-2 border-sos bg-sos-bg p-4">
      <div className="grid grid-cols-2 gap-3">
        <a href="tel:108" className="btn-sos min-h-14">
          <Icon name="ambulance" /> {t('Call 108')}
        </a>
        <a href="tel:112" className="btn min-h-14 border-2 border-sos bg-surface text-sos-dark">
          {t('Call 112')}
        </a>
      </div>
      {state ? (
        <p role="status" className={`rounded-2xl p-3.5 ${state === 'sent' ? 'bg-leaf-soft text-leaf-dark' : 'bg-warn-soft text-warn'}`}>
          {state === 'sent' ? t('Alert sent. The hospital will call your phone.') : t('Saved. It sends when there is signal. Send the SMS too:')}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {EMERGENCY_CODES.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={codes.includes(c)}
                onClick={() => setCodes((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]))}
                className={`min-h-11 rounded-full px-4 text-[15px] font-semibold ${codes.includes(c) ? 'bg-sos text-white' : 'border border-sos-line bg-surface'}`}
              >
                {pick(SYMPTOMS[c].label)}
              </button>
            ))}
          </div>
          <button type="button" className="btn-sos min-h-14 text-lg" onClick={send}>
            {online ? t('Send alert now') : t('Save alert (no signal)')}
          </button>
        </>
      )}
      {(!online || state === 'queued') && (
        <a href={sms} className="btn min-h-12 border-2 border-sos bg-surface text-sos-dark">
          <Icon name="sms" size={20} /> {t('Send SMS alert')}
        </a>
      )}
      {state && (
        <button type="button" className="text-sm font-semibold underline" onClick={onDone}>
          {t('Close')}
        </button>
      )}
    </section>
  );
}
