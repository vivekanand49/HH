// Profile page: the people this account manages, adding one (a child or elder
// without a phone directly; anyone with a phone agrees by reading out a code),
// and who manages this account.
import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Icon from './Icon';
import { ErrorNote } from './ui';
import { api } from '../lib/api';
import { RELATIONS, ageYears, pick, relationLabel } from '../lib/labels';
import { familyLoaded, profileSwitched } from '../store';

const EMPTY = { full_name: '', relation: 'child', gender: '', date_of_birth: '', blood_group: '', phone: '' };

function AddMember({ onDone, onCancel }) {
  const { t } = useTranslation();
  const [f, setF] = useState(EMPTY);
  const [hasPhone, setHasPhone] = useState(false);
  const [pending, setPending] = useState(null); // waiting for the code from their phone
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { full_name: f.full_name, relation: f.relation };
      for (const k of ['gender', 'date_of_birth', 'blood_group']) if (f[k]) body[k] = f[k];
      if (hasPhone) body.phone = f.phone;
      const res = await api('/family', { method: 'POST', body, profileId: null });
      if (res.needsCode) {
        setPending(res);
        if (res.devCode) setCode(res.devCode); // development only
      } else onDone(res.member);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api('/family/confirm', { method: 'POST', body: { requestId: pending.requestId, code }, profileId: null });
      onDone(res.member);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (pending) {
    return (
      <form onSubmit={confirm} className="flex flex-col gap-4 rounded-2xl border border-line p-4">
        <p className="text-[15px]">
          {t('We sent a code to {{phone}}. Ask {{name}} to read it out to you — they agree to you managing their health profile by sharing it.', {
            phone: pending.sentTo,
            name: f.full_name.split(' ')[0],
          })}
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="label">{t('6-digit code')}</span>
          <input
            className="input text-center font-mono text-2xl tracking-[0.4em]"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            required
          />
        </label>
        <ErrorNote error={error} />
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className="btn-outline" onClick={onCancel}>
            {t('Cancel')}
          </button>
          <button type="submit" className="btn-primary" disabled={busy || code.length !== 6}>
            {t('Confirm')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-line p-4">
      <label className="flex flex-col gap-1.5">
        <span className="label">{t('Full name')}</span>
        <input className="input" value={f.full_name} onChange={set('full_name')} minLength={2} maxLength={120} required />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">{t('Relation to you')}</span>
        <select className="input" value={f.relation} onChange={set('relation')}>
          {Object.keys(RELATIONS).map((k) => (
            <option key={k} value={k}>
              {pick(RELATIONS[k])}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="label">{t('Gender')}</span>
          <select className="input" value={f.gender} onChange={set('gender')}>
            <option value="">—</option>
            <option value="female">{t('female')}</option>
            <option value="male">{t('male')}</option>
            <option value="other">{t('other')}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">{t('Date of birth')}</span>
          <input className="input" type="date" max={new Date().toISOString().slice(0, 10)} value={f.date_of_birth} onChange={set('date_of_birth')} />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="label">{t('Blood group')}</span>
        <select className="input" value={f.blood_group} onChange={set('blood_group')}>
          <option value="">{t('Not known')}</option>
          {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
      </label>
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1 size-5 accent-brand" checked={hasPhone} onChange={(e) => setHasPhone(e.target.checked)} />
        <span className="text-[15px]">{t('They have their own mobile number')}</span>
      </label>
      {hasPhone ? (
        <label className="flex flex-col gap-1.5">
          <span className="label">{t('Their mobile number')}</span>
          <input className="input" inputMode="tel" placeholder="98765 43210" value={f.phone} onChange={set('phone')} required />
          <span className="text-sm text-muted">{t('A code goes to their phone. They share it with you only if they agree.')}</span>
        </label>
      ) : (
        <p className="rounded-2xl bg-brand-soft p-3.5 text-sm text-brand">
          {t('For a child, or an elder without a phone. You will be their emergency contact, and you agree to keep their health records here on their behalf.')}
        </p>
      )}
      <ErrorNote error={error} />
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className="btn-outline" onClick={onCancel}>
          {t('Cancel')}
        </button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {hasPhone ? t('Send code') : t('Add')}
        </button>
      </div>
    </form>
  );
}

export default function FamilySection() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    try {
      const d = await api('/family', { profileId: null });
      setData(d);
      dispatch(familyLoaded(d.members));
    } catch (err) {
      setError(err);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function unlink(id, message) {
    if (!window.confirm(message)) return;
    try {
      await api(`/family/${id}`, { method: 'DELETE', profileId: null });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  function open(member) {
    dispatch(profileSwitched(member));
    navigate('/');
  }

  const members = data?.members ?? [];
  return (
    <section className="card mb-5 flex flex-col gap-4 p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent">
          <Icon name="family" />
        </span>
        <div>
          <h2 className="text-lg font-bold">{t('Family')}</h2>
          <p className="text-sm text-muted">{t('Book visits, keep records and get help for your children and parents from this phone.')}</p>
        </div>
      </div>
      <ErrorNote error={error} onRetry={load} />

      {members.length > 0 && (
        <ul className="flex flex-col divide-y divide-line-soft">
          {members.map((m) => {
            const age = ageYears(m.date_of_birth);
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-soft text-lg font-bold text-brand" aria-hidden="true">
                  {m.full_name?.charAt(0)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{m.full_name}</span>
                  <span className="block text-sm text-muted">
                    {[relationLabel(m.relation), age != null && t('{{n}} years', { n: age }), m.phone_masked].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="flex gap-2">
                  <button type="button" className="btn-primary min-h-11 px-4 text-sm" onClick={() => open(m)}>
                    {t('Open')}
                  </button>
                  <button
                    type="button"
                    aria-label={t('Remove {{name}}', { name: m.full_name })}
                    className="grid size-11 place-items-center rounded-xl border border-line text-muted"
                    onClick={() => unlink(m.id, t('Remove {{name}} from your family? Their health records are kept.', { name: m.full_name }))}
                  >
                    <Icon name="close" size={18} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <AddMember
          onCancel={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            load();
          }}
        />
      ) : (
        <button type="button" className="btn-outline" onClick={() => setAdding(true)}>
          <Icon name="plus" size={18} /> {t('Add family member')}
        </button>
      )}

      {data?.managedBy?.length > 0 && (
        <div className="rounded-2xl bg-bg p-4">
          <h3 className="font-bold">{t('Who can manage my health profile')}</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {data.managedBy.map((g) => (
              <li key={g.id} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 text-[15px]">
                  {g.full_name || t('Family member')} <span className="text-muted">{g.phone_masked}</span>
                </span>
                <button
                  type="button"
                  className="text-sm font-semibold text-sos-dark underline"
                  onClick={() => unlink(g.id, t('Stop {{name}} from managing your health profile?', { name: g.full_name || g.phone_masked }))}
                >
                  {t('Remove')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
