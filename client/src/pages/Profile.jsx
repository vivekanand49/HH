import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import Icon from '../components/Icon';
import { ErrorNote, PageTitle } from '../components/ui';
import { api } from '../lib/api';
import { cacheClear } from '../lib/offline';
import { getLocation } from '../lib/location';
import { closeSocket } from '../lib/socket';
import { currentSubscription, disablePush, enablePush, pushSupport } from '../lib/push';
import { LANGUAGES, setLanguage } from '../i18n';
import { activeUpdated, selectActive, signOut } from '../store';
import FamilySection from '../components/FamilySection';
import { relationLabel } from '../lib/labels';

function Reminders({ user, patch }) {
  const { t } = useTranslation();
  const [onDevice, setOnDevice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const support = pushSupport();

  useEffect(() => {
    currentSubscription().then(
      (s) => setOnDevice(Boolean(s)),
      () => setOnDevice(false),
    );
  }, []);

  async function toggleDevice() {
    setBusy(true);
    setError(null);
    try {
      if (onDevice) await disablePush();
      else await enablePush();
      setOnDevice(!onDevice);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card mb-5 flex flex-col gap-4 p-5">
      <h2 className="text-lg font-bold">{t('Medicine reminders')}</h2>
      <p className="-mt-2 text-sm text-muted">{t('A reminder at each dose time, for medicines your doctor added.')}</p>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-5 accent-brand"
          checked={user.reminders_enabled}
          onChange={(e) => patch({ reminders_enabled: e.target.checked }, t('Saved.'))}
        />
        <span className="text-[15px]">{t('Remind me to take my medicines')}</span>
      </label>
      {user.reminders_enabled && (
        <>
          {support === 'ok' && (
            <button type="button" className={onDevice ? 'btn-outline' : 'btn-primary'} onClick={toggleDevice} disabled={busy || onDevice === null}>
              {onDevice ? t('Stop notifications on this phone') : t('Get notifications on this phone')}
            </button>
          )}
          {support === 'ios-install' && (
            <p className="rounded-2xl bg-warn-soft p-3.5 text-sm text-warn">
              {t('On iPhone: tap Share, then “Add to Home Screen”, open the app from there, and turn on notifications.')}
            </p>
          )}
          {support === 'denied' && (
            <p className="rounded-2xl bg-warn-soft p-3.5 text-sm text-warn">{t('Notifications are blocked. Allow them in your browser settings.')}</p>
          )}
          <ErrorNote error={error} />
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-5 accent-brand"
              checked={user.reminder_sms}
              onChange={(e) => patch({ reminder_sms: e.target.checked }, t('Saved.'))}
            />
            <span className="text-[15px]">{t('Also send reminders by SMS (for a basic phone)')}</span>
          </label>
        </>
      )}
    </section>
  );
}

// Remount per person so the form shows the right details after switching profile.
export default function Profile() {
  const user = useSelector(selectActive);
  return <ProfileFor key={user.id} user={user} />;
}

function ProfileFor({ user }) {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch();
  const acting = useSelector((s) => Boolean(s.session.profile));
  const role = useSelector((s) => s.session.user.role);
  const [form, setForm] = useState({
    full_name: user.full_name ?? '',
    emergency_contact_name: user.emergency_contact_name ?? '',
    emergency_contact_phone: user.emergency_contact_phone?.replace('+91', '') ?? '',
    blood_group: user.blood_group ?? '',
  });
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  async function patch(body, done) {
    setError(null);
    setMsg(null);
    try {
      const res = await api('/me', { method: 'PATCH', body });
      dispatch(activeUpdated(res.user));
      setMsg(done);
    } catch (err) {
      setError(err);
    }
  }

  function save(e) {
    e.preventDefault();
    const body = { full_name: form.full_name || undefined, emergency_contact_name: form.emergency_contact_name || undefined };
    if (form.emergency_contact_phone) body.emergency_contact_phone = form.emergency_contact_phone;
    if (form.blood_group) body.blood_group = form.blood_group;
    patch(body, t('Saved.'));
  }

  async function updateLocation() {
    const loc = await getLocation({ timeout: 15000, maxAge: 0 });
    if (!loc) return setError(new Error(t('Could not get your location. Turn on location and try again.')));
    patch({ lat: loc.lat, lng: loc.lng }, t('Home location saved. It is used if GPS is off in an emergency.'));
  }

  async function logout() {
    await disablePush().catch(() => {});
    await cacheClear();
    closeSocket();
    dispatch(signOut());
  }

  // Lost phone? This signs out every device, including this one.
  async function logoutEverywhere() {
    if (!window.confirm(t('Sign out on all phones and computers?'))) return;
    try {
      await api('/auth/logout-all', { method: 'POST' });
      await logout();
    } catch (err) {
      setError(err);
    }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const lang = acting ? user.language : i18n.language;

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle
        title={acting ? user.full_name : t('Profile')}
        image="/img/vizag.jpg"
        subtitle={acting ? [relationLabel(user.relation), user.phone_masked].filter(Boolean).join(' · ') : user.phone_masked}
      />
      <ErrorNote error={error} />
      {msg && (
        <p role="status" className="mb-4 rounded-2xl bg-leaf-soft p-3.5 text-leaf-dark">
          {msg}
        </p>
      )}

      <section className="card mb-5 p-5">
        <h2 className="mb-3 text-lg font-bold">{acting ? t('Language for SMS') : t('Language')}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              lang={l.code}
              aria-pressed={lang === l.code}
              onClick={() => {
                // For a family member this only sets the language of their SMS, not this phone's.
                if (!acting) setLanguage(l.code);
                patch({ language: l.code }, acting ? t('Saved.') : null);
              }}
              className={`min-h-12 rounded-xl text-lg font-semibold ${lang === l.code ? 'bg-brand text-white' : 'border border-line'}`}
            >
              {l.native}
            </button>
          ))}
        </div>
      </section>

      <form onSubmit={save} className="card mb-5 flex flex-col gap-4 p-5">
        <h2 className="text-lg font-bold">{acting ? t('Details') : t('My details')}</h2>
        <label className="flex flex-col gap-1.5">
          <span className="label">{t('Full name')}</span>
          <input className="input" value={form.full_name} onChange={set('full_name')} maxLength={120} autoComplete="name" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">{t('Blood group')}</span>
          <select className="input" value={form.blood_group} onChange={set('blood_group')}>
            <option value="">{t('Not known')}</option>
            {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <h3 className="mt-2 font-bold">{t('Emergency contact')}</h3>
        <p className="-mt-2 text-sm text-muted">{t('Gets an SMS with your location when you ask for emergency help.')}</p>
        <label className="flex flex-col gap-1.5">
          <span className="label">{t('Name')}</span>
          <input className="input" value={form.emergency_contact_name} onChange={set('emergency_contact_name')} maxLength={120} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">{t('Mobile number')}</span>
          <input className="input" inputMode="tel" value={form.emergency_contact_phone} onChange={set('emergency_contact_phone')} placeholder="98765 43210" />
        </label>
        <button type="submit" className="btn-primary">
          {t('Save')}
        </button>
      </form>

      <section className="card mb-5 flex flex-col gap-4 p-5">
        <h2 className="text-lg font-bold">{t('Emergency settings')}</h2>
        <button type="button" className="btn-outline" onClick={updateLocation}>
          <Icon name="pin" size={18} /> {t('Save my home location')}
        </button>
        <p className="text-sm text-muted">
          {t('Your SOS code')}: <strong className="font-mono text-base text-ink">{user.sos_code}</strong> —{' '}
          {t('included in emergency SMS so the hospital knows it is you.')}
        </p>
      </section>

      {role === 'patient' && !acting && <FamilySection />}

      {user.role === 'patient' && <Reminders user={user} patch={patch} />}

      <section className="card mb-5 flex flex-col gap-3 p-5">
        <h2 className="text-lg font-bold">{t('Privacy')}</h2>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 size-5 accent-brand"
            checked={user.records_consent}
            onChange={(e) => patch({ records_consent: e.target.checked }, t('Saved.'))}
          />
          <span className="text-[15px]">{t('Allow hospitals I visit, and the health assistant, to see my health records for my care.')}</span>
        </label>
        <p className="text-sm text-muted">{t('In an emergency, responders always see your allergies, conditions and medicines. Every view is logged.')}</p>
      </section>

      {!acting && (
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" className="btn-outline w-full" onClick={logout}>
            {t('Sign out')}
          </button>
          <button type="button" className="btn-outline w-full text-sos-dark" onClick={logoutEverywhere}>
            {t('Sign out on all devices')}
          </button>
        </div>
      )}
    </div>
  );
}
