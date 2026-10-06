import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import Icon from '../components/Icon';
import { ErrorNote, LanguagePicker, Logo } from '../components/ui';
import { api } from '../lib/api';
import { ADMIN_ROLES, signedIn, STAFF_ROLES } from '../store';
import { hasChosenLanguage } from '../i18n';

const METHODS = {
  aadhaar: {
    tab: 'Aadhaar',
    label: 'Aadhaar number',
    placeholder: '0000 0000 0000',
    help: '12 digits. The OTP goes to the mobile linked with your Aadhaar.',
    max: 14,
  },
  abha: {
    tab: 'ABHA',
    label: 'ABHA number (Health ID)',
    placeholder: '00-0000-0000-0000',
    help: '14-digit Ayushman Bharat Health Account number. Links records from any hospital in India.',
    max: 17,
  },
  mobile: {
    tab: 'Mobile',
    label: 'Mobile number',
    placeholder: '98765 43210',
    help: 'For first-time users without Aadhaar or ABHA. You can link one later.',
    max: 13,
  },
};

// Shown on the photo panel (PC) — what the app does, like the header of the poster.
const FEATURES = [
  ['shield', 'Secure Aadhaar login'],
  ['hospital', 'Government + private hospitals'],
  ['video', 'Video consult with doctors'],
  ['phone', 'Emergency help, even without internet'],
];

const homeFor = (role) =>
  role === 'doctor' ? '/doctor' : role === 'health_worker' ? '/worker' : ADMIN_ROLES.includes(role) ? '/admin' : STAFF_ROLES.includes(role) ? '/console' : '/';

export default function Login() {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useSelector((s) => s.session.user);

  const [method, setMethod] = useState('aadhaar');
  const [value, setValue] = useState('');
  const [consent, setConsent] = useState(true);
  const [otp, setOtp] = useState(null); // { requestId, sentTo, devCode }
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!hasChosenLanguage()) return <Navigate to="/welcome" replace />;
  if (user) return <Navigate to={homeFor(user.role)} replace />;

  const m = METHODS[method];

  async function requestOtp(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setOtp(await api('/auth/otp/request', { method: 'POST', body: { method, value, language: i18n.language } }));
      setCode('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api('/auth/otp/verify', { method: 'POST', body: { requestId: otp.requestId, code } });
      dispatch(signedIn(res));
      // Save language and consent choices made before sign-in.
      const patch = { language: i18n.language };
      if (res.user.role === 'patient' && consent !== res.user.records_consent) patch.records_consent = consent;
      api('/me', { method: 'PATCH', body: patch }).catch(() => {});
      navigate(res.user.role === 'patient' ? location.state?.from || '/' : homeFor(res.user.role), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh lg:grid lg:grid-cols-[1.1fr_1fr]">
      {/* Photo panel: top of the screen on a phone, the whole left side on a PC. */}
      <section className="hero relative flex h-72 flex-col overflow-hidden lg:sticky lg:top-0 lg:h-dvh">
        <img src="/img/family.jpg" alt="" width={640} height={420} className="absolute inset-0 h-full w-full object-cover object-[50%_30%]" />
        <div className="absolute inset-0 bg-gradient-to-b from-brand-dark/80 via-brand/45 to-brand-dark/85 lg:bg-gradient-to-br lg:from-brand-dark/90 lg:via-brand/60 lg:to-brand-dark/40" />
        <div className="absolute top-4 right-4 z-10 lg:hidden">
          <LanguagePicker light />
        </div>
        {/* Phone: logo in the centre of the photo */}
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 px-6 pt-12 pb-8 text-center lg:hidden">
          <span className="rounded-3xl bg-white/95 px-4 py-3 shadow-xl">
            <Logo size={52} tagline />
          </span>
          <p className="text-[15px] font-semibold text-white">{t('Your health. Our priority.')}</p>
        </div>
        {/* PC: logo, welcome and features */}
        <div className="relative z-10 hidden h-full flex-col justify-between p-12 xl:p-16 lg:flex">
          <Logo size={64} tagline light />
          <div className="flex max-w-lg flex-col gap-5">
            <h1 className="text-6xl leading-tight font-bold">{t('Welcome back!')}</h1>
            <p className="text-xl text-white/90">{t('Sign in to care for your whole family.')}</p>
            <ul className="mt-2 grid grid-cols-2 gap-3">
              {FEATURES.map(([icon, label]) => (
                <li key={icon} className="flex items-center gap-3 rounded-2xl bg-white/12 p-3 text-[15px] font-semibold backdrop-blur-sm">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-brand">
                    <Icon name={icon} size={20} />
                  </span>
                  {t(label)}
                </li>
              ))}
            </ul>
          </div>
          <p className="font-display text-lg font-bold text-white/90">{t('Healthy Vizag, stronger tomorrow')}</p>
        </div>
      </section>

      {/* Form: a card that overlaps the photo on a phone; centred on the right on a PC. */}
      <section className="relative z-10 -mt-6 flex justify-center rounded-t-[28px] bg-bg lg:mt-0 lg:items-center lg:rounded-none lg:bg-transparent">
        <div className="flex min-h-[calc(100dvh-14rem)] w-full max-w-md flex-col gap-6 px-6 pt-7 pb-8 lg:min-h-0 lg:py-12">
          <div className="hidden justify-end lg:flex">
            <LanguagePicker />
          </div>
          <div className="text-center lg:text-left">
            <h2 className="text-[28px] leading-tight font-bold lg:hidden">{t('Welcome back!')}</h2>
            <h2 className="hidden text-3xl font-bold lg:block">{t('Sign in')}</h2>
            <p className="mt-1 text-base text-muted">{t('One ID for all your records — government and private hospitals.')}</p>
          </div>

          <ErrorNote error={error} />

          {!otp ? (
            <form onSubmit={requestOtp} className="flex flex-1 flex-col gap-5">
              <div className="flex gap-1 rounded-2xl bg-line-soft p-1" role="tablist" aria-label={t('Sign in with')}>
                {Object.entries(METHODS).map(([key, info]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={method === key}
                    onClick={() => {
                      setMethod(key);
                      setValue('');
                    }}
                    className={`min-h-11 flex-1 rounded-xl text-[15px] font-semibold ${method === key ? 'bg-surface shadow-sm' : 'text-muted'}`}
                  >
                    {t(info.tab)}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="idnum" className="label">
                  {t(m.label)}
                </label>
                <input
                  id="idnum"
                  className="input tracking-widest"
                  inputMode="numeric"
                  autoComplete={method === 'mobile' ? 'tel-national' : 'off'}
                  placeholder={m.placeholder}
                  maxLength={m.max}
                  value={value}
                  onChange={(e) => setValue(e.target.value.replace(/[^\d\s-]/g, ''))}
                  required
                />
                <p className="text-sm text-muted">{t(m.help)}</p>
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-surface p-4">
                <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-brand" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span className="text-[15px]">
                  {t('I allow hospitals I visit to see my health records for my care. I can withdraw this any time in Profile.')}
                </span>
              </label>

              <div className="flex-1" />
              <button type="submit" className="btn-primary min-h-14 text-lg" disabled={busy || value.replace(/\D/g, '').length < 10}>
                {busy ? t('Sending…') : t('Send OTP')}
              </button>
            </form>
          ) : (
            <form onSubmit={verify} className="flex flex-1 flex-col gap-5">
              <p className="text-base">
                {otp.sentTo
                  ? t('Enter the 6-digit code sent to {{phone}}', { phone: otp.sentTo })
                  : t('Enter the 6-digit code sent to the mobile linked with your ID')}
              </p>
              {otp.devCode && (
                <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn">
                  {t('Demo mode: your code is')} <strong className="tracking-widest">{otp.devCode}</strong>
                </p>
              )}
              <label htmlFor="otp" className="sr-only">
                {t('OTP code')}
              </label>
              <input
                id="otp"
                className="input text-center text-3xl tracking-[0.5em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                autoFocus
                required
              />
              <p className="flex items-center gap-2 text-sm text-muted">
                <Icon name="clock" size={16} /> {t('The code works for 5 minutes. 3 tries allowed.')}
              </p>
              <div className="flex gap-5">
                <button type="button" className="min-h-11 font-semibold text-brand underline" onClick={() => setOtp(null)}>
                  {t('Change number')}
                </button>
                <button type="button" className="min-h-11 font-semibold text-brand underline" onClick={requestOtp} disabled={busy}>
                  {t('Send a new code')}
                </button>
              </div>
              <div className="flex-1" />
              <button type="submit" className="btn-primary min-h-14 text-lg" disabled={busy || code.length !== 6}>
                {busy ? t('Checking…') : t('Verify and continue')}
              </button>
            </form>
          )}

          <p className="flex items-start gap-2.5 text-sm text-muted">
            <Icon name="shield" size={18} className="text-brand" />
            {t('Your ID is encrypted. We never show or store your Aadhaar number in full.')}
          </p>
          <Link to="/emergency" className="btn-sos">
            <Icon name="phone" size={20} /> {t('Emergency — no sign-in needed')}
          </Link>
        </div>
      </section>
    </main>
  );
}
