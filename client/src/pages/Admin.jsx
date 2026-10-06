// Hospital admin portal: beds, doctors and their OPD schedule, leave days,
// staff logins and refunds. The district admin can switch between hospitals.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../components/Icon';
import { ErrorNote, Loading, PageTitle } from '../components/ui';
import { api } from '../lib/api';
import { deptLabel } from '../lib/labels';
import { getSocket } from '../lib/socket';
import { formatDateTime } from '../i18n';

const TABS = [
  ['overview', 'Overview'],
  ['doctors', 'Doctors'],
  ['staff', 'Staff'],
  ['counter', 'Pay at counter'],
  ['refunds', 'Refunds'],
  ['profile', 'Hospital details'],
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const istDay = (d = new Date()) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addDays = (day, n) => istDay(new Date(Date.parse(`${day}T12:00:00+05:30`) + n * 86400000));
const num = (v) => (v === '' || v == null ? null : Number(v));

function useLoad(path) {
  const [state, setState] = useState({ data: null, error: null });
  const load = useCallback(() => {
    if (!path) return;
    api(path).then(
      (data) => setState({ data, error: null }),
      (error) => setState((s) => ({ ...s, error })),
    );
  }, [path]);
  useEffect(load, [load]);
  return { ...state, reload: load };
}

// Runs an API call with busy / error / done message handling for a form.
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const run = async (fn, doneText) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const out = await fn();
      setDone(typeof doneText === 'function' ? doneText(out) : doneText);
      return out;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, done, run };
}

function Done({ text }) {
  if (!text) return null;
  return (
    <p role="status" className="flex items-center gap-2 rounded-2xl bg-leaf-soft p-3 text-leaf-dark">
      <Icon name="check" size={18} /> {text}
    </p>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-sm text-muted">{hint}</span>}
    </label>
  );
}

export default function Admin() {
  const { t } = useTranslation();
  const hospitals = useLoad('/admin/hospitals');
  const [hid, setHid] = useState(null);
  const [tab, setTab] = useState('overview');
  const list = hospitals.data?.hospitals ?? [];
  const district = hospitals.data?.district;

  useEffect(() => {
    if (!hid && list.length) setHid(list[0].id);
  }, [hid, list]);

  const current = list.find((h) => h.id === hid);

  return (
    <div>
      <PageTitle title={t('Hospital admin')} subtitle={current?.name} />
      <ErrorNote error={hospitals.error} onRetry={hospitals.reload} />
      {!hospitals.data && !hospitals.error && <Loading />}

      {district && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Field label={t('Hospital')}>
            <select
              className="input min-w-72"
              value={hid ?? ''}
              onChange={(e) => {
                setHid(e.target.value);
                setTab('overview');
              }}
            >
              {list.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                  {h.is_active ? '' : ` (${t('closed')})`}
                </option>
              ))}
            </select>
          </Field>
          <button type="button" className={`btn-outline ${tab === 'new' ? 'border-brand' : ''}`} onClick={() => setTab('new')}>
            + {t('Add hospital')}
          </button>
        </div>
      )}

      {tab === 'new' ? (
        <NewHospital
          departments={hospitals.data.departments}
          onCreated={(h) => {
            hospitals.reload();
            setHid(h.id);
            setTab('overview');
          }}
        />
      ) : (
        hid && (
          <>
            <div role="tablist" aria-label={t('Sections')} className="mb-5 flex gap-2 overflow-x-auto pb-1">
              {TABS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={`chip shrink-0 ${tab === key ? 'border-brand bg-brand text-white' : ''}`}
                >
                  {t(label)}
                </button>
              ))}
            </div>
            <HospitalView key={hid} hid={hid} tab={tab} district={district} onChanged={hospitals.reload} />
          </>
        )
      )}
    </div>
  );
}

function HospitalView({ hid, tab, district, onChanged }) {
  const summary = useLoad(`/admin/hospitals/${hid}`);

  // Beds or bookings changed on another device: refresh the numbers.
  useEffect(() => {
    const s = getSocket();
    if (!s) return undefined;
    const refresh = (p) => (!p?.id || p.id === hid || p.doctor) && summary.reload();
    s.on('hospital:beds', refresh);
    s.on('appointment:new', refresh);
    return () => {
      s.off('hospital:beds', refresh);
      s.off('appointment:new', refresh);
    };
  }, [hid, summary.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  if (summary.error) return <ErrorNote error={summary.error} onRetry={summary.reload} />;
  if (!summary.data) return <Loading />;
  const reload = () => {
    summary.reload();
    onChanged();
  };
  const h = summary.data.hospital;

  if (tab === 'doctors') return <Doctors hid={hid} hospital={h} onChanged={reload} />;
  if (tab === 'staff') return <Staff hid={hid} />;
  if (tab === 'counter') return <CounterPayments hid={hid} onChanged={reload} />;
  if (tab === 'refunds') return <Refunds hid={hid} onChanged={reload} />;
  if (tab === 'profile') return <Profile hospital={h} district={district} departments={summary.data.departments} onSaved={reload} />;
  return <Overview data={summary.data} onSaved={reload} />;
}

function Stat({ label, value, tone = '' }) {
  return (
    <div className={`card p-4 ${tone}`}>
      <p className="text-sm font-semibold text-muted">{label}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
    </div>
  );
}

function Overview({ data, onSaved }) {
  const { t } = useTranslation();
  const h = data.hospital;
  const today = data.today;
  const booked = (today.confirmed ?? 0) + (today.completed ?? 0) + (today.pending_payment ?? 0);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('Appointments today')} value={booked} />
        <Stat label={t('Seen today')} value={today.completed ?? 0} />
        <Stat label={t('Active doctors')} value={data.doctors} />
        <Stat label={t('Open emergencies')} value={data.openAlerts} tone={data.openAlerts ? 'border-sos-line bg-sos-soft' : ''} />
      </div>

      {(data.doctorsWithoutSlots.length > 0 || data.refundsDue > 0 || data.counterDue > 0) && (
        <div className="flex flex-col gap-2 rounded-2xl bg-warn-soft p-4 text-warn">
          {data.doctorsWithoutSlots.length > 0 && (
            <p className="flex gap-2">
              <Icon name="alert" size={20} />
              <span>
                {t('Patients cannot book these doctors (no free time in the next 7 days)')}:{' '}
                <b>{data.doctorsWithoutSlots.map((d) => d.full_name).join(', ')}</b>
              </span>
            </p>
          )}
          {data.refundsDue > 0 && (
            <p className="flex gap-2">
              <Icon name="alert" size={20} /> {t('{{n}} refunds waiting', { n: data.refundsDue })}
            </p>
          )}
          {data.counterDue > 0 && (
            <p className="flex gap-2">
              <Icon name="cash" size={20} /> {t('{{n}} patients will pay at the counter', { n: data.counterDue })}
            </p>
          )}
        </div>
      )}

      <Beds hospital={h} onSaved={onSaved} />
    </div>
  );
}

function Counter({ label, value, onChange, max }) {
  const { t } = useTranslation();
  const v = Number(value) || 0;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-outline size-14 px-0 text-2xl" aria-label={t('Less')} onClick={() => onChange(Math.max(0, v - 1))}>
          −
        </button>
        <input
          className="input w-24 text-center text-2xl font-bold"
          type="number"
          min={0}
          max={max ?? undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
        />
        <button
          type="button"
          className="btn-outline size-14 px-0 text-2xl"
          aria-label={t('More')}
          onClick={() => onChange(max != null ? Math.min(max, v + 1) : v + 1)}
        >
          +
        </button>
      </div>
    </div>
  );
}

function Beds({ hospital: h, onSaved }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ beds_free: h.beds_free, er_beds_free: h.er_beds_free, beds_total: h.beds_total ?? '', er_beds_total: h.er_beds_total ?? '' });
  const act = useAction();
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = (e) => {
    e.preventDefault();
    act.run(
      () =>
        api(`/admin/hospitals/${h.id}/beds`, {
          method: 'PUT',
          body: {
            beds_free: Number(f.beds_free) || 0,
            er_beds_free: Number(f.er_beds_free) || 0,
            beds_total: num(f.beds_total),
            er_beds_total: num(f.er_beds_total),
          },
        }).then(onSaved),
      t('Beds updated. Ambulances and patients see this now.'),
    );
  };
  return (
    <form onSubmit={save} className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold">{t('Free beds')}</h2>
        {h.beds_updated_at && <span className="text-sm text-muted">{t('Last updated {{when}}', { when: formatDateTime(h.beds_updated_at) })}</span>}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Counter label={t('Ward beds free')} value={f.beds_free} onChange={set('beds_free')} max={num(f.beds_total)} />
        {h.has_emergency && <Counter label={t('Emergency beds free')} value={f.er_beds_free} onChange={set('er_beds_free')} max={num(f.er_beds_total)} />}
      </div>
      <details>
        <summary className="cursor-pointer font-semibold text-brand">{t('Total beds')}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={t('Ward beds total')}>
            <input className="input" type="number" min={0} value={f.beds_total} onChange={(e) => set('beds_total')(e.target.value)} />
          </Field>
          {h.has_emergency && (
            <Field label={t('Emergency beds total')}>
              <input className="input" type="number" min={0} value={f.er_beds_total} onChange={(e) => set('er_beds_total')(e.target.value)} />
            </Field>
          )}
        </div>
      </details>
      {h.has_emergency && (
        <p className="text-sm text-muted">{t('When emergency beds are 0, new emergencies go to another ER close by (up to 5 km further).')}</p>
      )}
      <ErrorNote error={act.error} />
      <Done text={act.done} />
      <button type="submit" className="btn-primary self-start" disabled={act.busy}>
        {act.busy ? t('Saving…') : t('Save beds')}
      </button>
    </form>
  );
}

// ---- Doctors ----

function Doctors({ hid, hospital, onChanged }) {
  const { t } = useTranslation();
  const docs = useLoad(`/admin/hospitals/${hid}/doctors`);
  const [open, setOpen] = useState(null); // doctor id, or 'new'
  const list = docs.data?.doctors ?? [];
  const reload = () => {
    docs.reload();
    onChanged();
  };
  const selected = list.find((d) => d.id === open);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-2.5">
        <button type="button" className="btn-primary" onClick={() => setOpen('new')}>
          + {t('Add doctor')}
        </button>
        <ErrorNote error={docs.error} onRetry={docs.reload} />
        {!docs.data && !docs.error && <Loading />}
        <ul className="flex flex-col gap-2">
          {list.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                aria-pressed={open === d.id}
                onClick={() => setOpen(d.id)}
                className={`flex w-full items-center gap-3 rounded-2xl border bg-surface p-3.5 text-left shadow-card ${open === d.id ? 'border-2 border-brand' : 'border-line'} ${d.is_active ? '' : 'opacity-60'}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{d.full_name}</span>
                  <span className="block truncate text-sm text-muted">
                    {deptLabel(d.department)} · {t('Room')} {d.room ?? '-'}
                  </span>
                </span>
                <span
                  className={`rounded-lg px-2 py-1 text-xs font-bold ${!d.is_active ? 'bg-line-soft' : d.free_slots_7d ? 'bg-leaf-soft text-leaf-dark' : 'bg-warn-soft text-warn'}`}
                >
                  {!d.is_active ? t('Inactive') : t('{{n}} free', { n: d.free_slots_7d })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        {open === 'new' && (
          <DoctorForm
            key="new"
            hid={hid}
            hospital={hospital}
            onSaved={(d) => {
              reload();
              setOpen(d.id);
            }}
          />
        )}
        {selected && <DoctorPanel key={selected.id} hid={hid} hospital={hospital} doctor={selected} onChanged={reload} />}
        {!open && list.length > 0 && (
          <p className="card hidden p-8 text-center text-muted lg:block">{t('Select a doctor to edit their details and OPD times.')}</p>
        )}
      </div>
    </div>
  );
}

function DoctorForm({ hid, hospital, doctor, onSaved }) {
  const { t } = useTranslation();
  const d = doctor;
  const [f, setF] = useState({
    full_name: d?.full_name ?? '',
    department: d?.department ?? hospital.departments[0] ?? '',
    qualifications: d?.qualifications?.join(', ') ?? 'MBBS',
    experience_years: d?.experience_years ?? '',
    languages: d?.languages?.join(', ') ?? 'Telugu, English',
    fee_inr: d?.fee_inr ?? 0,
    video_fee_inr: d?.video_fee_inr ?? '',
    opd_block: d?.opd_block ?? 'A',
    room: d?.room ?? '',
    login_phone: '',
  });
  const act = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const split = (s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  const isPrivate = hospital.type === 'private';

  const save = (e) => {
    e.preventDefault();
    const body = {
      full_name: f.full_name,
      department: f.department,
      qualifications: split(f.qualifications),
      experience_years: num(f.experience_years),
      languages: split(f.languages),
      fee_inr: isPrivate ? Number(f.fee_inr) || 0 : 0,
      video_fee_inr: isPrivate ? num(f.video_fee_inr) : null,
      opd_block: f.opd_block || 'A',
      room: f.room || null,
    };
    if (!d && f.login_phone) body.login_phone = f.login_phone;
    act.run(
      () =>
        api(d ? `/admin/hospitals/${hid}/doctors/${d.id}` : `/admin/hospitals/${hid}/doctors`, { method: d ? 'PATCH' : 'POST', body }).then((out) =>
          onSaved(out.doctor),
        ),
      t('Saved'),
    );
  };

  return (
    <form onSubmit={save} className="card flex flex-col gap-4 p-5">
      <h2 className="text-xl font-bold">{d ? t('Doctor details') : t('Add doctor')}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('Full name')}>
          <input className="input" value={f.full_name} onChange={set('full_name')} required minLength={3} placeholder="Dr. …" />
        </Field>
        <Field label={t('Department')}>
          <select className="input" value={f.department} onChange={set('department')} required>
            {hospital.departments.map((k) => (
              <option key={k} value={k}>
                {deptLabel(k)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Qualifications')} hint={t('Separate with commas')}>
          <input className="input" value={f.qualifications} onChange={set('qualifications')} />
        </Field>
        <Field label={t('Years of experience')}>
          <input className="input" type="number" min={0} max={70} value={f.experience_years} onChange={set('experience_years')} />
        </Field>
        <Field label={t('Languages spoken')} hint={t('Separate with commas')}>
          <input className="input" value={f.languages} onChange={set('languages')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('OPD block')}>
            <input className="input" value={f.opd_block} onChange={set('opd_block')} maxLength={10} />
          </Field>
          <Field label={t('Room')}>
            <input className="input" value={f.room} onChange={set('room')} maxLength={20} />
          </Field>
        </div>
        {isPrivate && (
          <>
            <Field label={t('Consultation fee (₹)')}>
              <input className="input" type="number" min={0} value={f.fee_inr} onChange={set('fee_inr')} />
            </Field>
            <Field label={t('Video consult fee (₹, optional)')}>
              <input className="input" type="number" min={0} value={f.video_fee_inr} onChange={set('video_fee_inr')} />
            </Field>
          </>
        )}
        {!d && (
          <Field label={t('Mobile for doctor app login (optional)')} hint={t('The doctor signs in with this number to see their patients.')}>
            <input className="input" inputMode="tel" value={f.login_phone} onChange={set('login_phone')} placeholder="98765 43210" />
          </Field>
        )}
      </div>
      {!isPrivate && <p className="text-sm text-muted">{t('Government hospital: consultations are free.')}</p>}
      <ErrorNote error={act.error} />
      <Done text={act.done} />
      <button type="submit" className="btn-primary self-start" disabled={act.busy}>
        {act.busy ? t('Saving…') : d ? t('Save changes') : t('Add doctor')}
      </button>
    </form>
  );
}

function DoctorPanel({ hid, hospital, doctor: d, onChanged }) {
  const { t } = useTranslation();
  const [view, setView] = useState('schedule');
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold">{d.full_name}</h2>
          <p className="text-muted">
            {deptLabel(d.department)} · {d.has_login ? t('App login: {{phone}}', { phone: d.login_phone_masked }) : t('No app login')}
          </p>
        </div>
        <ActiveToggle hid={hid} doctor={d} onChanged={onChanged} />
      </div>
      <div className="flex flex-wrap gap-2">
        {[
          ['schedule', 'OPD times'],
          ['leave', 'Leave'],
          ['details', 'Details'],
        ].map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={view === k}
            onClick={() => setView(k)}
            className={`chip ${view === k ? 'border-brand bg-brand-soft text-brand' : ''}`}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {view === 'schedule' &&
        (d.is_active ? (
          <Schedule hid={hid} doctor={d} onChanged={onChanged} />
        ) : (
          <p className="card p-4 text-muted">{t('This doctor is inactive. Turn them back on to add OPD times.')}</p>
        ))}
      {view === 'leave' && <Leave hid={hid} doctor={d} onChanged={onChanged} />}
      {view === 'details' && (
        <>
          <DoctorForm hid={hid} hospital={hospital} doctor={d} onSaved={onChanged} />
          {!d.has_login && <LinkLogin hid={hid} doctor={d} onChanged={onChanged} />}
        </>
      )}
    </section>
  );
}

function ActiveToggle({ hid, doctor: d, onChanged }) {
  const { t } = useTranslation();
  const act = useAction();
  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        className={d.is_active ? 'btn-outline' : 'btn-primary'}
        disabled={act.busy}
        onClick={() => act.run(() => api(`/admin/hospitals/${hid}/doctors/${d.id}`, { method: 'PATCH', body: { is_active: !d.is_active } }).then(onChanged))}
      >
        {d.is_active ? t('Mark inactive') : t('Mark active')}
      </button>
      <ErrorNote error={act.error} />
    </div>
  );
}

function LinkLogin({ hid, doctor: d, onChanged }) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  const act = useAction();
  return (
    <form
      className="card flex flex-col gap-3 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        act.run(() => api(`/admin/hospitals/${hid}/doctors/${d.id}/login`, { method: 'POST', body: { phone } }).then(onChanged));
      }}
    >
      <h3 className="text-lg font-bold">{t('Give doctor app login')}</h3>
      <Field label={t('Mobile number')} hint={t('The doctor signs in with this number to see their patients.')}>
        <input className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
      </Field>
      <ErrorNote error={act.error} />
      <button type="submit" className="btn-primary self-start" disabled={act.busy}>
        {t('Create login')}
      </button>
    </form>
  );
}

function Schedule({ hid, doctor: d, onChanged }) {
  const { t } = useTranslation();
  const today = istDay();
  const [from, setFrom] = useState(today);
  const slots = useLoad(`/admin/hospitals/${hid}/doctors/${d.id}/slots?from=${from}&days=7`);
  const [f, setF] = useState({
    from: today,
    to: addDays(today, 27),
    weekdays: [1, 2, 3, 4, 5, 6],
    start: '09:00',
    end: '13:00',
    duration_min: 15,
    break_start: '',
    break_end: '',
  });
  const act = useAction();
  const blockAct = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const toggleDay = (n) => setF((x) => ({ ...x, weekdays: x.weekdays.includes(n) ? x.weekdays.filter((y) => y !== n) : [...x.weekdays, n].sort() }));
  const reload = () => {
    slots.reload();
    onChanged();
  };

  const create = (e) => {
    e.preventDefault();
    const body = { ...f, duration_min: Number(f.duration_min) };
    if (!f.break_start || !f.break_end) {
      delete body.break_start;
      delete body.break_end;
    }
    act.run(
      () => api(`/admin/hospitals/${hid}/doctors/${d.id}/schedule`, { method: 'POST', body }).then((out) => (reload(), out)),
      (out) => t('{{n}} new time slots added', { n: out.created }),
    );
  };

  const toggleSlot = (s) =>
    blockAct.run(() =>
      api(`/admin/hospitals/${hid}/doctors/${d.id}/slots/${s.id}/block`, { method: 'POST', body: { blocked: s.state === 'free' } }).then(reload),
    );

  const byDay = {};
  for (const s of slots.data?.slots ?? []) (byDay[istDay(s.starts_at)] ||= []).push(s);

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={create} className="card flex flex-col gap-4 p-5">
        <h3 className="text-lg font-bold">{t('Add OPD times')}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('From')}>
            <input className="input" type="date" min={today} value={f.from} onChange={set('from')} required />
          </Field>
          <Field label={t('To')}>
            <input className="input" type="date" min={f.from} max={addDays(f.from, 60)} value={f.to} onChange={set('to')} required />
          </Field>
        </div>
        <fieldset>
          <legend className="label mb-1.5">{t('Days')}</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((w, n) => (
              <button
                key={w}
                type="button"
                aria-pressed={f.weekdays.includes(n)}
                onClick={() => toggleDay(n)}
                className={`chip ${f.weekdays.includes(n) ? 'border-brand bg-brand text-white' : ''}`}
              >
                {t(w)}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label={t('Start')}>
            <input className="input" type="time" value={f.start} onChange={set('start')} required />
          </Field>
          <Field label={t('End')}>
            <input className="input" type="time" value={f.end} onChange={set('end')} required />
          </Field>
          <Field label={t('Minutes per patient')}>
            <select className="input" value={f.duration_min} onChange={set('duration_min')}>
              {[10, 15, 20, 30, 45, 60].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Break from (optional)')}>
            <input className="input" type="time" value={f.break_start} onChange={set('break_start')} />
          </Field>
          <Field label={t('Break to')}>
            <input className="input" type="time" value={f.break_end} onChange={set('break_end')} />
          </Field>
        </div>
        <p className="text-sm text-muted">{t('Times that are already in the schedule are skipped, so nothing is added twice.')}</p>
        <ErrorNote error={act.error} />
        <Done text={act.done} />
        <button type="submit" className="btn-primary self-start" disabled={act.busy || !f.weekdays.length}>
          {act.busy ? t('Saving…') : t('Add times')}
        </button>
      </form>

      <div className="card flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="flex-1 text-lg font-bold">{t('Next 7 days')}</h3>
          <button
            type="button"
            className="btn-outline min-h-11 px-3"
            aria-label={t('Earlier')}
            disabled={from <= today}
            onClick={() => setFrom(addDays(from, -7))}
          >
            <Icon name="left" />
          </button>
          <button type="button" className="btn-outline min-h-11 px-3" aria-label={t('Later')} onClick={() => setFrom(addDays(from, 7))}>
            <Icon name="right" />
          </button>
        </div>
        <p className="flex flex-wrap gap-3 text-sm text-muted">
          <span>
            <span className="mr-1 inline-block size-3 rounded bg-leaf-soft ring-1 ring-leaf" />
            {t('Free')}
          </span>
          <span>
            <span className="mr-1 inline-block size-3 rounded bg-brand" />
            {t('Booked')}
          </span>
          <span>
            <span className="mr-1 inline-block size-3 rounded bg-line" />
            {t('Closed')}
          </span>
          <span>· {t('Tap a free or closed time to close or open it.')}</span>
        </p>
        <ErrorNote error={slots.error || blockAct.error} onRetry={slots.reload} />
        {!slots.data && !slots.error && <Loading />}
        {slots.data && !Object.keys(byDay).length && <p className="text-muted">{t('No OPD times in these days. Add times above.')}</p>}
        {Object.entries(byDay).map(([dayKey, list]) => (
          <div key={dayKey}>
            <p className="mb-1.5 font-semibold">{formatDateTime(`${dayKey}T12:00:00+05:30`, { weekday: 'long', day: 'numeric', month: 'short' })}</p>
            <div className="flex flex-wrap gap-1.5">
              {list.map((s) => {
                const time = formatDateTime(s.starts_at, { hour: 'numeric', minute: '2-digit' });
                const past = new Date(s.starts_at) <= new Date();
                const cls =
                  s.state === 'booked'
                    ? 'bg-brand text-white border-brand'
                    : s.state === 'blocked'
                      ? 'bg-line text-muted line-through'
                      : 'bg-leaf-soft text-leaf-dark border-leaf';
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={s.state === 'booked' || past || blockAct.busy}
                    onClick={() => toggleSlot(s)}
                    title={s.state === 'booked' ? `${t('Token')} ${s.token}` : undefined}
                    className={`min-h-10 rounded-xl border px-2.5 text-sm font-semibold disabled:cursor-default ${cls} ${past ? 'opacity-50' : ''}`}
                  >
                    {time}
                    {s.state === 'booked' && s.visit_type === 'video' && ' ▶'}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Leave({ hid, doctor: d, onChanged }) {
  const { t } = useTranslation();
  const [date, setDate] = useState(istDay());
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const act = useAction();
  const submit = (e) => {
    e.preventDefault();
    if (!confirming) return setConfirming(true);
    setConfirming(false);
    act.run(
      () =>
        api(`/admin/hospitals/${hid}/doctors/${d.id}/leave`, { method: 'POST', body: { date, reason: reason || undefined } }).then((out) => (onChanged(), out)),
      (out) =>
        t('Leave saved. {{n}} patients were told by SMS.', { n: out.cancelled }) +
        (out.refundsDue ? ` ${t('{{n}} refunds waiting', { n: out.refundsDue })}.` : ''),
    );
  };
  return (
    <form onSubmit={submit} className="card flex flex-col gap-4 p-5">
      <h3 className="text-lg font-bold">{t('Doctor on leave')}</h3>
      <p className="text-muted">
        {t(
          'Closes all times on this day. Booked patients get an SMS in their language (villagers without a phone: their ASHA worker). Paid visits are added to Refunds.',
        )}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('Date')}>
          <input
            className="input"
            type="date"
            min={istDay()}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setConfirming(false);
            }}
            required
          />
        </Field>
        <Field label={t('Reason (optional)')}>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={t('Doctor on leave')} />
        </Field>
      </div>
      <ErrorNote error={act.error} />
      <Done text={act.done} />
      {confirming && (
        <p className="rounded-2xl bg-warn-soft p-3 text-warn">
          {t('This cancels every booking with {{name}} on this day. Press again to confirm.', { name: d.full_name })}
        </p>
      )}
      <button type="submit" className={`${confirming ? 'btn-sos' : 'btn-primary'} self-start`} disabled={act.busy}>
        {act.busy ? t('Saving…') : confirming ? t('Yes, cancel bookings and close the day') : t('Mark leave')}
      </button>
    </form>
  );
}

// ---- Staff ----

const ROLE_LABELS = { hospital_staff: 'Emergency desk / front desk', hospital_admin: 'Hospital admin', doctor: 'Doctor' };

function Staff({ hid }) {
  const { t } = useTranslation();
  const staff = useLoad(`/admin/hospitals/${hid}/staff`);
  const [f, setF] = useState({ full_name: '', phone: '', role: 'hospital_staff' });
  const add = useAction();
  const toggle = useAction();

  const submit = (e) => {
    e.preventDefault();
    add.run(
      () =>
        api(`/admin/hospitals/${hid}/staff`, { method: 'POST', body: f }).then(() => {
          setF({ full_name: '', phone: '', role: 'hospital_staff' });
          staff.reload();
        }),
      t('Added. They can sign in with their mobile number now.'),
    );
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
      <div className="card p-2">
        <ErrorNote error={staff.error || toggle.error} onRetry={staff.reload} />
        {!staff.data && !staff.error && <Loading />}
        <ul className="divide-y divide-line">
          {(staff.data?.staff ?? []).map((s) => (
            <li key={s.id} className={`flex flex-wrap items-center gap-3 p-3 ${s.is_active ? '' : 'opacity-60'}`}>
              <span className="grid size-11 place-items-center rounded-full bg-brand-soft font-bold text-brand">
                {(s.full_name ?? '?').replace(/^Dr\.?\s*/, '').charAt(0)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{s.full_name}</span>
                <span className="block truncate text-sm text-muted">
                  {t(ROLE_LABELS[s.role])} · {s.phone_masked} ·{' '}
                  {s.last_login_at
                    ? t('Last sign-in {{when}}', { when: formatDateTime(s.last_login_at, { day: 'numeric', month: 'short' }) })
                    : t('Never signed in')}
                </span>
              </span>
              <button
                type="button"
                className={s.is_active ? 'btn-outline min-h-11' : 'btn-primary min-h-11'}
                disabled={toggle.busy}
                onClick={() =>
                  toggle.run(() => api(`/admin/hospitals/${hid}/staff/${s.id}/active`, { method: 'POST', body: { active: !s.is_active } }).then(staff.reload))
                }
              >
                {s.is_active ? t('Turn off') : t('Turn on')}
              </button>
            </li>
          ))}
        </ul>
        <p className="p-3 text-sm text-muted">{t('Turning off signs the person out on every device straight away.')}</p>
      </div>

      <form onSubmit={submit} className="card flex flex-col gap-4 p-5">
        <h2 className="text-xl font-bold">{t('Add staff')}</h2>
        <Field label={t('Full name')}>
          <input className="input" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} required minLength={2} />
        </Field>
        <Field label={t('Mobile number')} hint={t('Use their work number. A number that already has a patient account with health records cannot be used.')}>
          <input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required />
        </Field>
        <Field label={t('Role')}>
          <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="hospital_staff">{t(ROLE_LABELS.hospital_staff)}</option>
            <option value="hospital_admin">{t(ROLE_LABELS.hospital_admin)}</option>
          </select>
        </Field>
        <p className="text-sm text-muted">{t('Doctors get their login from the Doctors tab.')}</p>
        <ErrorNote error={add.error} />
        <Done text={add.done} />
        <button type="submit" className="btn-primary self-start" disabled={add.busy}>
          {t('Add staff')}
        </button>
      </form>
    </div>
  );
}

// ---- Pay at counter ----

// Patients who chose to pay cash / UPI on arrival. Reception marks each one when collected.
function CounterPayments({ hid, onChanged }) {
  const { t } = useTranslation();
  const counter = useLoad(`/admin/hospitals/${hid}/counter`);
  const act = useAction();
  const list = counter.data?.counter ?? [];
  const collect = (id, method) =>
    act.run(() =>
      api(`/admin/hospitals/${hid}/counter/${id}`, { method: 'POST', body: { method } }).then(() => {
        counter.reload();
        onChanged();
      }),
    );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted">{t('Patients who chose to pay at the counter. Collect the fee when they arrive, then mark how they paid.')}</p>
      <ErrorNote error={counter.error || act.error} onRetry={counter.reload} />
      {!counter.data && !counter.error && <Loading />}
      {counter.data && !list.length && <p className="card p-5 text-muted">{t('No counter payments waiting.')}</p>}
      {list.map((c) => (
        <div key={c.id} className="card flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="flex-1 font-semibold">
              {c.patient_name ?? t('Patient')} · {c.patient_phone_masked} · {t('Token')} {c.token}
            </span>
            <span className="text-xl font-bold">₹{c.fee_inr}</span>
          </div>
          <p className="text-sm text-muted">
            {c.doctor_name} · {formatDateTime(c.starts_at)}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[
              ['cash', t('Cash')],
              ['upi', 'UPI'],
              ['card', t('Card')],
            ].map(([m, label]) => (
              <button key={m} type="button" className="btn-outline" disabled={act.busy} onClick={() => collect(c.id, m)}>
                {t('Paid by {{how}}', { how: label })}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Refunds ----

function Refunds({ hid, onChanged }) {
  const { t } = useTranslation();
  const refunds = useLoad(`/admin/hospitals/${hid}/refunds`);
  const [notes, setNotes] = useState({});
  const act = useAction();
  const list = refunds.data?.refunds ?? [];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted">
        {t('Paid visits cancelled by the hospital. Return the money (UPI, counter or the Razorpay dashboard), then note how it was paid back.')}
      </p>
      <ErrorNote error={refunds.error || act.error} onRetry={refunds.reload} />
      {!refunds.data && !refunds.error && <Loading />}
      {refunds.data && !list.length && <p className="card p-5 text-muted">{t('No refunds waiting.')}</p>}
      {list.map((r) => (
        <form
          key={r.id}
          className="card flex flex-col gap-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            act.run(() =>
              api(`/admin/hospitals/${hid}/refunds/${r.id}`, { method: 'POST', body: { note: notes[r.id] } }).then(() => {
                refunds.reload();
                onChanged();
              }),
            );
          }}
        >
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="flex-1 font-semibold">
              {r.patient_name ?? t('Patient')} · {r.patient_phone_masked}
            </span>
            <span className="text-xl font-bold">₹{r.fee_inr}</span>
          </div>
          <p className="text-sm text-muted">
            {r.doctor_name} · {formatDateTime(r.starts_at)} · {r.cancel_reason} {r.payment_id && `· ${r.provider} ${r.payment_id}`}
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              className="input min-h-12 flex-1 text-base"
              placeholder={t('How was it refunded? e.g. UPI ref 1234')}
              value={notes[r.id] ?? ''}
              onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
              required
              minLength={2}
            />
            <button type="submit" className="btn-primary" disabled={act.busy}>
              {t('Mark refunded')}
            </button>
          </div>
        </form>
      ))}
    </div>
  );
}

// ---- Hospital details ----

function HospitalFields({ f, set, departments, district }) {
  const { t } = useTranslation();
  const toggleDept = (k) => set('departments')(f.departments.includes(k) ? f.departments.filter((x) => x !== k) : [...f.departments, k]);
  const input = (k, props = {}) => <input className="input" value={f[k] ?? ''} onChange={(e) => set(k)(e.target.value)} {...props} />;
  return (
    <>
      {district && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Hospital name')}>{input('name', { required: true, minLength: 3 })}</Field>
          <Field label={t('Type')}>
            <select className="input" value={f.type} onChange={(e) => set('type')(e.target.value)}>
              <option value="government">{t('Government')}</option>
              <option value="private">{t('Private')}</option>
            </select>
          </Field>
          <Field label={t('Latitude')}>{input('lat', { type: 'number', step: 'any', required: true })}</Field>
          <Field label={t('Longitude')}>{input('lng', { type: 'number', step: 'any', required: true })}</Field>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('Address')}>{input('address', { required: true, minLength: 5 })}</Field>
        <Field label={t('Area')}>{input('area')}</Field>
        <Field label={t('PIN code')}>{input('pincode', { inputMode: 'numeric', pattern: '\\d{6}' })}</Field>
        <Field label={t('Reception phone')}>{input('phone', { inputMode: 'tel' })}</Field>
        <Field label={t('Emergency phone')}>{input('emergency_phone', { inputMode: 'tel' })}</Field>
        <Field label={t('Number for booking SMS')} hint={t('Each new booking is sent here as an SMS.')}>
          {input('sms_number', { inputMode: 'tel' })}
        </Field>
      </div>
      <label className="flex items-center gap-3">
        <input type="checkbox" className="size-6 accent-brand" checked={f.has_emergency} onChange={(e) => set('has_emergency')(e.target.checked)} />
        <span className="font-semibold">{t('Has a 24×7 emergency department')}</span>
      </label>
      <fieldset>
        <legend className="label mb-1.5">{t('Departments')}</legend>
        <div className="flex flex-wrap gap-2">
          {departments.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={f.departments.includes(k)}
              onClick={() => toggleDept(k)}
              className={`chip ${f.departments.includes(k) ? 'border-brand bg-brand text-white' : ''}`}
            >
              {deptLabel(k)}
            </button>
          ))}
        </div>
      </fieldset>
    </>
  );
}

const PROFILE_KEYS = ['address', 'area', 'pincode', 'phone', 'emergency_phone', 'sms_number', 'departments', 'has_emergency'];
const clean = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v]));

function Profile({ hospital: h, district, departments, onSaved }) {
  const { t } = useTranslation();
  const keys = district ? [...PROFILE_KEYS, 'name', 'type', 'lat', 'lng', 'is_active'] : PROFILE_KEYS;
  const [f, setF] = useState(() => Object.fromEntries(keys.map((k) => [k, h[k] ?? (k === 'departments' ? [] : '')])));
  const act = useAction();
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = (e) => {
    e.preventDefault();
    const body = clean(f);
    if (district) {
      body.lat = Number(f.lat);
      body.lng = Number(f.lng);
    }
    act.run(() => api(`/admin/hospitals/${h.id}`, { method: 'PATCH', body }).then(onSaved), t('Saved'));
  };
  return (
    <form onSubmit={save} className="card flex flex-col gap-4 p-5">
      <HospitalFields f={f} set={set} departments={departments} district={district} />
      {district && (
        <label className="flex items-center gap-3">
          <input type="checkbox" className="size-6 accent-brand" checked={f.is_active} onChange={(e) => set('is_active')(e.target.checked)} />
          <span className="font-semibold">{t('Open (shown to patients)')}</span>
        </label>
      )}
      {!district && <p className="text-sm text-muted">{t('To change the name, type or map location, contact the district health office.')}</p>}
      <ErrorNote error={act.error} />
      <Done text={act.done} />
      <button type="submit" className="btn-primary self-start" disabled={act.busy}>
        {act.busy ? t('Saving…') : t('Save changes')}
      </button>
    </form>
  );
}

function NewHospital({ departments, onCreated }) {
  const { t } = useTranslation();
  const [f, setF] = useState({
    name: '',
    type: 'government',
    lat: '',
    lng: '',
    address: '',
    area: '',
    pincode: '',
    phone: '',
    emergency_phone: '',
    sms_number: '',
    departments: ['general'],
    has_emergency: false,
  });
  const act = useAction();
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = (e) => {
    e.preventDefault();
    act.run(() =>
      api('/admin/hospitals', { method: 'POST', body: { ...clean(f), lat: Number(f.lat), lng: Number(f.lng) } }).then((out) => onCreated(out.hospital)),
    );
  };
  return (
    <form onSubmit={save} className="card flex flex-col gap-4 p-5">
      <h2 className="text-xl font-bold">{t('Add hospital')}</h2>
      <HospitalFields f={f} set={set} departments={departments} district />
      <p className="text-sm text-muted">{t('Tip: copy latitude and longitude from Google Maps (long-press the building).')}</p>
      <ErrorNote error={act.error} />
      <button type="submit" className="btn-primary self-start" disabled={act.busy}>
        {act.busy ? t('Saving…') : t('Add hospital')}
      </button>
    </form>
  );
}
