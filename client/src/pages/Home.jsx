import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import Icon from '../components/Icon';
import { ErrorNote, LanguagePicker, Loading, StaleNote } from '../components/ui';
import { FamilySwitcher } from '../components/Family';
import { useCachedApi } from '../lib/api';
import { deptLabel } from '../lib/labels';
import { formatDateTime } from '../i18n';
import { selectActive } from '../store';

function greetingKey() {
  const h = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

// "Taken" ticks are kept on the phone per day (medicine ids are unique per person).
function useTakenToday() {
  const key = `taken:${new Date().toISOString().slice(0, 10)}`;
  const [taken, setTaken] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(key)) || {};
    } catch {
      return {};
    }
  });
  const toggle = (id) => {
    const next = { ...taken, [id]: !taken[id] };
    setTaken(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  return [taken, toggle];
}

export default function Home() {
  const { t } = useTranslation();
  const user = useSelector(selectActive);
  const acting = useSelector((s) => Boolean(s.session.profile));
  const { data, loading, error, stale, savedAt, reload } = useCachedApi('/me/summary');
  const [taken, toggleTaken] = useTakenToday();

  const doses = (data?.medications ?? []).flatMap((m) =>
    (m.times.length ? m.times : ['']).map((time) => ({ id: `${m.id}@${time}`, name: `${m.name} ${m.dose ?? ''}`.trim(), time, instructions: m.instructions })),
  );
  const left = doses.filter((d) => !taken[d.id]).length;
  const next = data?.nextAppointment;

  const actions = [
    { to: '/book', icon: 'calendar', label: t('Book a visit'), tone: 'bg-brand-soft text-brand' },
    { to: '/book?visit=video', icon: 'video', label: t('Video consult'), tone: 'bg-leaf-soft text-leaf-dark' },
    { to: '/records', icon: 'file', label: t('My records'), tone: 'bg-warn-soft text-warn' },
    { to: '/assistant', icon: 'chat', label: t('Ask health assistant'), tone: 'bg-accent-soft text-accent' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3.5">
        <span
          className="grid size-14 shrink-0 place-items-center rounded-full bg-brand text-2xl font-bold text-white ring-4 ring-brand-soft"
          aria-hidden="true"
        >
          {(user?.full_name ?? '').trim().charAt(0) || <Icon name="user" size={26} />}
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-brand">{acting ? t('Family profile') : t(greetingKey())}</p>
          <h1 className="truncate text-[27px] leading-tight font-bold md:text-4xl">
            {acting ? user.full_name : user?.full_name ? t('Welcome, {{name}}', { name: user.full_name.split(' ')[0] }) : t('Welcome!')}
          </h1>
          <p className="text-[15px] text-muted">
            {t('Health ID')} ••••{user?.aadhaar_last4 || user?.sos_code?.slice(-4)}
          </p>
        </div>
        <span className="ml-auto hidden shrink-0 sm:block">
          <LanguagePicker />
        </span>
      </div>

      <FamilySwitcher label={t('Whose health?')} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Link to="/emergency" className="lift flex items-center gap-4 rounded-3xl bg-sos p-5 text-white hover:bg-sos-dark lg:col-span-3">
          <span className="grid size-14 shrink-0 place-items-center rounded-full bg-white text-sos">
            <Icon name="phone" size={28} />
          </span>
          <span className="flex-1">
            <span className="block text-[22px] font-bold">{t('Emergency')}</span>
            <span className="text-[15px]">{t('Tap to get help now — works even without internet')}</span>
          </span>
          <Icon name="right" size={24} strokeWidth={2.5} />
        </Link>

        <Link to="/quick-book" className="card lift flex items-center gap-4 p-5 lg:col-span-3">
          <span className="grid size-14 shrink-0 place-items-center rounded-full bg-brand text-white ring-4 ring-brand-soft">
            <Icon name="mic" size={26} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xl font-bold">{t('Book by voice')}</span>
            <span className="text-[15px] text-muted">{t('Say your problem. We book the earliest doctor near you.')}</span>
          </span>
          <Icon name="right" size={24} className="text-brand" />
        </Link>

        <Link to="/book?visit=video" className="hero lift relative flex min-h-40 overflow-hidden rounded-3xl lg:col-span-3">
          <span className="relative z-10 flex max-w-[62%] flex-col justify-center gap-1.5 p-5 md:max-w-md md:p-7">
            <span className="text-[22px] leading-tight font-bold md:text-3xl">{t('Talk to a doctor from home')}</span>
            <span className="text-[15px] text-white/90">{t('Video consult in your language, with live captions.')}</span>
            <span className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-[15px] font-bold text-brand">
              <Icon name="video" size={18} /> {t('Book video consult')}
            </span>
          </span>
          <img
            src="/img/doctor-hero.jpg"
            alt=""
            width={400}
            height={460}
            loading="lazy"
            className="absolute right-0 bottom-0 h-full w-[42%] object-cover object-top md:w-72 [mask-image:linear-gradient(to_right,transparent,black_35%)]"
          />
        </Link>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:col-span-3">
          {actions.map((a) => (
            <Link key={a.to} to={a.to} className="card lift flex min-h-28 flex-col gap-3 p-4">
              <span className={`grid size-11 place-items-center rounded-xl ${a.tone}`}>
                <Icon name={a.icon} />
              </span>
              <span className="text-base leading-snug font-semibold">{a.label}</span>
            </Link>
          ))}
        </div>
      </div>

      <StaleNote stale={stale} savedAt={savedAt} />
      <ErrorNote error={error} onRetry={reload} />
      {loading && !data && <Loading />}

      {data && (
        <div className="grid gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2">
            <div className="mb-2.5 flex items-baseline justify-between">
              <h2 className="text-xl font-bold">{t('Next appointment')}</h2>
              <Link to="/book" className="text-sm font-semibold text-brand">
                {t('Book another')}
              </Link>
            </div>
            {next ? (
              <Link to={`/appointments/${next.id}`} className="card flex gap-4 p-4 hover:border-muted/40">
                <div className="flex w-16 shrink-0 flex-col items-center rounded-2xl bg-brand-soft py-2 text-brand">
                  <span className="text-xs font-bold uppercase">{formatDateTime(next.starts_at, { weekday: 'short' })}</span>
                  <span className="text-2xl leading-tight font-bold">{formatDateTime(next.starts_at, { day: 'numeric' })}</span>
                  <span className="text-xs font-bold uppercase">{formatDateTime(next.starts_at, { month: 'short' })}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-[17px] font-semibold">{next.doctor_name}</p>
                  <p className="text-sm text-muted">
                    {deptLabel(next.department)} · {next.hospital_name}
                  </p>
                  <p className="text-sm">
                    {formatDateTime(next.starts_at, { hour: 'numeric', minute: '2-digit' })} · {t('Room')} {next.room ?? '-'}
                  </p>
                  <p className="text-sm font-semibold text-leaf-dark">
                    {t('Token')} {next.token} · {next.fee_inr ? `₹${next.fee_inr}` : t('Free')}
                  </p>
                </div>
              </Link>
            ) : (
              <div className="card p-5 text-muted">
                {t('No upcoming appointments.')}{' '}
                <Link to="/book" className="font-semibold text-brand">
                  {t('Book a visit')}
                </Link>
              </div>
            )}
          </section>

          <section>
            <div className="mb-2.5 flex items-baseline justify-between">
              <h2 className="text-xl font-bold">{t('Today’s medicines')}</h2>
              {doses.length > 0 && <span className="text-sm text-muted">{t('{{n}} left', { n: left })}</span>}
            </div>
            <ul className="card divide-y divide-line-soft overflow-hidden">
              {doses.length === 0 && <li className="p-4 text-muted">{t('No medicines right now.')}</li>}
              {doses.map((d) => (
                <li key={d.id} className="flex items-center gap-3 p-3.5">
                  <span className="grid size-10 place-items-center rounded-xl bg-warn-soft text-warn">
                    <Icon name="pill" size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{d.name}</span>
                    <span className="text-sm text-muted">{[d.time, d.instructions].filter(Boolean).join(' · ')}</span>
                  </span>
                  <button
                    type="button"
                    aria-pressed={Boolean(taken[d.id])}
                    onClick={() => toggleTaken(d.id)}
                    className={`min-h-10 min-w-24 rounded-xl px-3 text-sm font-semibold ${taken[d.id] ? 'bg-leaf-soft text-leaf-dark' : 'border border-line'}`}
                  >
                    {taken[d.id] ? `✓ ${t('Taken')}` : t('Mark taken')}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="lg:col-span-3">
            <h2 className="mb-2.5 text-xl font-bold">{t('Health conditions')}</h2>
            <div className="flex flex-wrap gap-2">
              {data.conditions.length === 0 && <span className="text-muted">{t('None recorded.')}</span>}
              {data.conditions.map((c) =>
                c.kind === 'allergy' ? (
                  <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full bg-sos-soft px-3.5 py-2 text-sm font-semibold text-sos-dark">
                    <Icon name="alert" size={16} /> {t('Allergy')}: {c.name}
                  </span>
                ) : (
                  <span key={c.id} className="rounded-full border border-line bg-surface px-3.5 py-2 text-sm">
                    {c.name} · {t(c.status)}
                  </span>
                ),
              )}
            </div>
          </section>
        </div>
      )}

      {/* Healthy Vizag: the city photo from the welcome screen. */}
      <figure className="relative overflow-hidden rounded-3xl">
        <img
          src="/img/vizag.jpg"
          alt={t('Visakhapatnam coast seen from Kailasagiri')}
          width={800}
          height={560}
          loading="lazy"
          className="h-44 w-full object-cover md:h-56"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-brand-dark/85 via-brand/40 to-transparent" />
        <figcaption className="absolute inset-y-0 left-0 flex max-w-sm flex-col justify-center gap-1.5 p-5 text-white md:p-7">
          <span className="font-display text-2xl leading-tight font-bold md:text-3xl">{t('Healthy Vizag, stronger tomorrow')}</span>
          <span className="text-[15px] text-white/90">{t('Government and private hospitals of Visakhapatnam, in one app.')}</span>
        </figcaption>
      </figure>
    </div>
  );
}
