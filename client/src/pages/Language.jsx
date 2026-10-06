// Welcome screen: first thing a new user sees. Blue welcome panel with a photo
// of Vizag, then the language choice and "Get started".
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import Icon from '../components/Icon';
import { Logo } from '../components/ui';
import { LANGUAGES, setLanguage } from '../i18n';

const FEATURES = [
  ['hospital', 'Government + private hospitals'],
  ['video', 'Video consult with doctors'],
  ['phone', 'Emergency help, even without internet'],
];

export default function Language() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const user = useSelector((s) => s.session.user);
  const [lang, setLang] = useState(i18n.language);

  const choose = (code) => {
    setLang(code);
    i18n.changeLanguage(code); // preview the screen in that language
  };

  return (
    <main className="min-h-dvh lg:grid lg:grid-cols-2">
      {/* Welcome panel */}
      <section className="hero relative flex flex-col overflow-hidden lg:min-h-dvh">
        <div className="relative z-10 flex flex-col items-center gap-3 px-6 pt-10 text-center lg:items-start lg:px-14 lg:pt-16 lg:text-left">
          <span className="rounded-3xl bg-white/95 px-4 py-3 shadow-xl">
            <Logo size={56} tagline />
          </span>
          <h1 className="mt-3 text-[40px] leading-tight font-bold lg:text-6xl">{t('Welcome!')}</h1>
          <p className="text-xl font-semibold lg:text-2xl">{t('Your health. Our priority.')}</p>
          <p className="max-w-md text-base text-white/90 lg:text-lg">
            {t('Book government and private hospitals, see your health records, talk to a doctor and get emergency help — all in one place.')}
          </p>
          <ul className="mt-2 flex flex-col gap-2.5 text-left">
            {FEATURES.map(([icon, label]) => (
              <li key={icon} className="flex items-center gap-3 text-base lg:text-lg">
                <span className="grid size-10 place-items-center rounded-xl bg-white/15">
                  <Icon name={icon} size={20} />
                </span>
                {t(label)}
              </li>
            ))}
          </ul>
        </div>
        <figure className="relative mt-6 flex-1 lg:mt-10">
          {/* Fades from the blue panel into the photo of Vizag's coast from Kailasagiri. */}
          <img
            src="/img/vizag.jpg"
            alt={t('Visakhapatnam coast seen from Kailasagiri')}
            width={800}
            height={560}
            className="h-56 w-full object-cover sm:h-72 lg:absolute lg:inset-0 lg:h-full"
          />
          <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-brand/80 to-transparent" />
          <figcaption className="absolute right-4 bottom-4 rounded-2xl bg-white/90 px-3.5 py-2 font-display text-[15px] font-bold text-brand shadow-lg">
            {t('Healthy Vizag, stronger tomorrow')}
          </figcaption>
        </figure>
      </section>

      {/* Language + start */}
      <section className="mx-auto flex w-full max-w-md flex-col gap-5 px-6 pt-7 pb-8 lg:justify-center lg:py-16">
        <div>
          <h2 className="text-[26px] leading-tight font-bold">{t('Choose your language')}</h2>
          <p className="mt-1.5 text-base text-muted">{t('Used for the app, SMS alerts and the health assistant. You can change it any time.')}</p>
        </div>
        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label={t('Language')}>
          {LANGUAGES.map((l) => {
            const on = l.code === lang;
            return (
              <button
                key={l.code}
                type="button"
                role="radio"
                aria-checked={on}
                lang={l.code}
                onClick={() => choose(l.code)}
                className={`relative flex min-h-20 flex-col justify-center rounded-2xl border-2 px-4 py-3 text-left transition-colors ${on ? 'border-brand bg-brand-soft' : 'border-line bg-surface'}`}
              >
                <span className="block text-[21px] leading-snug font-semibold">{l.native}</span>
                <span className="text-sm text-muted">{l.english}</span>
                {on && (
                  <span className="absolute top-2.5 right-2.5 grid size-6 place-items-center rounded-full bg-brand text-white">
                    <Icon name="check" size={14} strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="btn-primary mt-2 min-h-14 text-lg shadow-lg shadow-brand/25"
          onClick={() => {
            setLanguage(lang);
            navigate(user ? '/' : '/login');
          }}
        >
          {t('Get started')} <Icon name="right" />
        </button>
        <p className="flex items-center justify-center gap-2 text-center text-sm text-muted">
          <Icon name="shield" size={16} /> {t('Works offline after the first visit · No app store needed')}
        </p>
      </section>
    </main>
  );
}
