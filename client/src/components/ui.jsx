import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import Icon from './Icon';
import { LANGUAGES as LANGUAGE_OPTIONS, formatDateTime, setLanguage } from '../i18n';
import { api, useCachedApi } from '../lib/api';

// The logo mark with the name. size = height of the mark in px; tagline adds the
// line under the name (used where there is room: sidebar, login, welcome).
export function Logo({ size = 40, withName = true, tagline = false, light = false }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-3">
      <img
        src="/icon-192.png"
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-2xl bg-white shadow-md shadow-brand/15"
      />
      {withName && (
        <span className="flex min-w-0 flex-col leading-none">
          <span
            className={`font-display font-extrabold tracking-tight whitespace-nowrap ${light ? 'text-white' : 'text-brand'}`}
            style={{ fontSize: Math.max(18, Math.round(size * 0.5)) }}
          >
            Swasthya <span className={light ? 'text-white' : 'text-leaf'}>Setu</span>
          </span>
          {tagline && (
            <span className={`mt-1 text-[11px] font-bold tracking-[0.12em] uppercase ${light ? 'text-white/85' : 'text-muted'}`}>
              {t('Vizag Health Connect')}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

// Change the app language from any screen. Signed-in people also get SMS in it.
// compact: just a globe button (phone top bar); the phone's own picker lists the languages.
export function LanguagePicker({ light = false, compact = false, className = '' }) {
  const { t, i18n } = useTranslation();
  const signedIn = useSelector((s) => Boolean(s.session.token));
  const change = (code) => {
    setLanguage(code);
    if (signedIn) {
      api('/me', { method: 'PATCH', body: { language: code }, profileId: null }).catch(() => {});
    }
  };
  const options = LANGUAGE_OPTIONS.map((l) => (
    <option key={l.code} value={l.code} lang={l.code}>
      {l.native}
    </option>
  ));
  if (compact) {
    return (
      <label className={`relative grid size-11 shrink-0 place-items-center rounded-full border border-line bg-surface text-brand ${className}`}>
        <Icon name="globe" size={20} />
        <select value={i18n.language} onChange={(e) => change(e.target.value)} aria-label={t('Language')} className="absolute inset-0 cursor-pointer opacity-0">
          {options}
        </select>
      </label>
    );
  }
  return (
    <label
      className={`relative inline-flex min-h-11 items-center gap-1.5 rounded-full border pr-3 pl-3 text-sm font-semibold ${
        light ? 'border-white/40 bg-white/15 text-white' : 'border-line bg-surface text-ink'
      } ${className}`}
    >
      <Icon name="globe" size={17} className={light ? '' : 'text-brand'} />
      <span className="sr-only">{t('Language')}</span>
      <select
        value={i18n.language}
        onChange={(e) => change(e.target.value)}
        className="cursor-pointer appearance-none bg-transparent pr-4 outline-none [&>option]:text-ink"
        aria-label={t('Language')}
      >
        {options}
      </select>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute right-2.5 size-3.5" fill="none" stroke="currentColor" strokeWidth="3">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </label>
  );
}

/**
 * Page heading. With `image`, a blue banner with a photo on the right
 * (the same look as the Home hero), so every main page has a picture.
 */
export function PageTitle({ title, subtitle, back, action, image, imagePosition = 'center' }) {
  const { t } = useTranslation();
  const backLink = back && (
    <Link
      to={back}
      aria-label={t('Back')}
      className={`grid size-11 shrink-0 place-items-center rounded-full border ${image ? 'border-white/40 bg-white/15 text-white' : 'border-line bg-surface'}`}
    >
      <Icon name="left" />
    </Link>
  );
  if (image) {
    return (
      <div className="hero relative mb-5 flex min-h-36 overflow-hidden rounded-3xl md:min-h-44">
        <div className="relative z-10 flex max-w-[64%] flex-1 items-start gap-3 p-5 md:max-w-[60%] md:p-7">
          {backLink}
          <div className="min-w-0 flex-1 self-center">
            <h1 className="text-[26px] leading-tight font-bold md:text-4xl">{title}</h1>
            {subtitle && <p className="mt-1.5 text-[15px] text-white/90 md:text-base">{subtitle}</p>}
            {action && <div className="mt-3">{action}</div>}
          </div>
        </div>
        <img
          src={image}
          alt=""
          width={400}
          height={300}
          loading="lazy"
          style={{ objectPosition: imagePosition }}
          className="absolute right-0 bottom-0 h-full w-[44%] object-cover [mask-image:linear-gradient(to_right,transparent,black_40%)] md:w-[46%]"
        />
      </div>
    );
  }
  return (
    <div className="mb-5 flex items-start gap-3">
      {backLink}
      <div className="min-w-0 flex-1">
        <h1 className="text-[26px] leading-tight font-bold md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// Shown on the shared staging server so nobody enters real patient details there.
export function StagingBanner() {
  const { t } = useTranslation();
  const { data } = useCachedApi('/emergency/config');
  if (!data?.staging) return null;
  return (
    <div role="note" className="bg-warn-soft px-4 py-1.5 text-center text-[13px] font-semibold text-warn">
      {t('Test server: demo data only. Do not enter real patient details.')}
    </div>
  );
}

export function OfflineBanner() {
  const { t } = useTranslation();
  const online = useSelector((s) => s.network.online);
  if (online) return null;
  return (
    <div role="status" className="mb-4 flex items-start gap-2.5 rounded-2xl bg-warn-soft p-3.5 text-[15px] text-warn">
      <Icon name="wifiOff" size={20} />
      <span>{t('You are offline. Showing saved data. Emergency help still works.')}</span>
    </div>
  );
}

export function StaleNote({ stale, savedAt }) {
  const { t } = useTranslation();
  if (!stale || !savedAt) return null;
  return <p className="mb-3 text-sm text-muted">{t('Saved copy from {{when}}', { when: formatDateTime(savedAt) })}</p>;
}

export function ErrorNote({ error, onRetry }) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-sos-soft p-3.5 text-[15px] text-sos-dark">
      <span className="flex-1">{error.message}</span>
      {onRetry && (
        <button type="button" className="font-semibold underline" onClick={onRetry}>
          {t('Try again')}
        </button>
      )}
    </div>
  );
}

export function Loading() {
  const { t } = useTranslation();
  return (
    <div role="status" className="py-10 text-center text-muted">
      {t('Loading…')}
    </div>
  );
}

// Big toggle card used across the booking flow and settings.
export function ChoiceCard({ selected, onClick, children, className = '' }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`w-full rounded-2xl border-2 p-4 text-left transition-colors ${selected ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:border-muted/40'} ${className}`}
    >
      {children}
    </button>
  );
}
