import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { triage, isUrgent } from '@swasthya/shared/triage';
import { departmentFromText, dayFromText } from '@swasthya/shared/chat';
import Icon from '../components/Icon';
import { ErrorNote, PageTitle } from '../components/ui';
import { deptLabel, DEPARTMENTS } from '../lib/labels';
import { getLocation } from '../lib/location';
import { findFastest, bookOption } from '../lib/booking';
import { canListen, listenOnce, speak, stopListening, stopSpeaking, VOICE_ERRORS, yesNo } from '../lib/speech';
import { formatDateTime, LANGUAGES } from '../i18n';

// Book by voice: say the problem ("fever since 3 days, doctor tomorrow"), hear the
// earliest free doctor nearby, say "yes" to book. Typing works the same way.
export default function QuickBook() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const visitType = params.get('visit') === 'video' ? 'video' : 'in_person';
  const user = useSelector((s) => s.session.user);
  const lang = LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0];

  const [text, setText] = useState(params.get('q') ?? '');
  const [dept, setDept] = useState(params.get('dept') && DEPARTMENTS[params.get('dept')] ? params.get('dept') : null);
  const [type, setType] = useState(null); // null = any
  const [state, setState] = useState('idle'); // idle | listening | searching | results | confirming | booking
  const [options, setOptions] = useState(null);
  const [urgent, setUrgent] = useState(false);
  const [error, setError] = useState(null);
  const [voiceError, setVoiceError] = useState(null);
  const loc = useRef(user?.lat != null ? { lat: user.lat, lng: user.lng } : null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    getLocation({ timeout: 8000 }).then((l) => l && (loc.current = l));
    if (dept) search({ department: dept, day: dayFromText(text) });
    return () => {
      alive.current = false;
      stopListening();
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function search({ department, day, byVoice = false, hospitalType = type }) {
    setState('searching');
    setError(null);
    try {
      const found = await findFastest({ department, day, type: hospitalType, loc: loc.current });
      if (!alive.current) return;
      setOptions(found);
      setState('results');
      if (byVoice && found.length) confirmByVoice(found, 0);
      else if (byVoice) say(t('Sorry, no free doctor found. Try another hospital type.'));
    } catch (err) {
      if (!alive.current) return;
      setError(err);
      setState('idle');
    }
  }

  async function say(text) {
    const out = await speak(text, lang.speech);
    if (!out.ok && alive.current) setVoiceError({ code: out.error });
  }

  function understand(said, byVoice) {
    const words = said.trim();
    if (!words) return;
    setText(words);
    if (isUrgent(triage(words).severity)) {
      setUrgent(true);
      setOptions(null);
      setState('idle');
      if (byVoice) say(t('This sounds serious. Open Emergency now or call 108.'));
      return;
    }
    setUrgent(false);
    const d = departmentFromText(words) ?? dept ?? 'general';
    setDept(d);
    search({ department: d, day: dayFromText(words), byVoice });
  }

  async function startVoice() {
    stopSpeaking();
    setVoiceError(null);
    setState('listening');
    const heard = await listenOnce(lang.speech, { onPartial: setText });
    if (!alive.current) return;
    if (!heard.text) {
      setVoiceError({ code: heard.error, detail: heard.detail });
      setState(options ? 'results' : 'idle');
      return;
    }
    understand(heard.text, true);
  }

  // Reads the option aloud and listens for yes / no ("no" moves to the next one).
  async function confirmByVoice(list, i) {
    const o = list[i];
    if (!o) return;
    setState('confirming');
    await say(
      t('{{doctor}} at {{hospital}}, {{time}}. Say yes to book, or no for the next one.', {
        doctor: o.doctor_name,
        hospital: o.hospital_name,
        time: formatDateTime(o.starts_at, { weekday: 'long', hour: 'numeric', minute: '2-digit' }),
      }),
    );
    if (!alive.current) return;
    const answer = yesNo((await listenOnce(lang.speech)).text);
    if (!alive.current) return;
    if (answer === 'yes') return book(o);
    setState('results');
    if (answer === 'no' && list[i + 1]) confirmByVoice(list, i + 1);
  }

  async function book(o) {
    stopListening();
    stopSpeaking();
    setState('booking');
    setError(null);
    try {
      const appointment = await bookOption(o, { visitType, complaint: text });
      navigate(`/appointments/${appointment.id}`, { replace: true, state: { justBooked: true } });
    } catch (err) {
      if (!alive.current) return;
      setError(err);
      setState('results');
      if (err.status === 409) search({ department: dept ?? 'general' });
    }
  }

  const listening = state === 'listening' || state === 'confirming';
  const busy = state === 'searching' || state === 'booking';

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle title={t('Book by voice')} subtitle={t('Say your problem. I will find the earliest free doctor near you.')} back="/" />

      <section className="card flex flex-col items-center gap-4 p-6 text-center">
        {canListen ? (
          <>
            <button
              type="button"
              onClick={listening ? () => (stopListening(), setState(options ? 'results' : 'idle')) : startVoice}
              disabled={busy}
              aria-pressed={listening}
              aria-label={listening ? t('Stop listening') : t('Tap and speak')}
              className={`mic-button ${listening ? 'is-listening' : ''}`}
            >
              <Icon name="mic" size={40} />
            </button>
            <p className="text-lg font-semibold" aria-live="polite">
              {state === 'listening'
                ? t('Listening… speak now')
                : state === 'confirming'
                  ? t('Say yes to book, or no for the next one')
                  : state === 'searching'
                    ? t('Finding the earliest doctor…')
                    : t('Tap and speak')}
            </p>
            <p className="text-sm text-muted">{t('For example: “Fever for 3 days, I need a doctor tomorrow”')}</p>
          </>
        ) : (
          <p className="text-[15px] text-muted">{t('Voice is not available in this browser. Type your problem below.')}</p>
        )}

        <form
          className="flex w-full items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            understand(text, false);
          }}
        >
          <label htmlFor="qb-text" className="sr-only">
            {t('Your problem')}
          </label>
          <input
            id="qb-text"
            className="input min-w-0 flex-1 text-base"
            placeholder={t('Or type: fever, sugar check, child cough…')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
          />
          <button type="submit" className="btn-primary min-h-14 shrink-0" disabled={!text.trim() || busy}>
            <Icon name="search" size={20} /> {t('Find')}
          </button>
        </form>

        <div className="flex flex-wrap justify-center gap-2" role="group" aria-label={t('Hospital type')}>
          {[
            [null, t('Any hospital')],
            ['government', t('Government')],
            ['private', t('Private')],
          ].map(([value, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={type === value}
              className={`chip ${type === value ? 'border-brand bg-brand-soft text-brand-dark' : ''}`}
              onClick={() => {
                setType(value);
                if (dept && options) search({ department: dept, hospitalType: value });
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <ErrorNote error={error} />
      {voiceError && (
        <p className="mt-3 rounded-2xl bg-warn-soft px-4 py-3 text-[15px] text-warn" role="status">
          {t(VOICE_ERRORS[voiceError.code])}
          {voiceError.detail && <span className="ml-1 text-xs opacity-70">({voiceError.detail})</span>}
        </p>
      )}

      {urgent && (
        <div className="mt-4 flex flex-col gap-3 rounded-3xl border-2 border-sos bg-sos-bg p-5" role="alert">
          <p className="text-lg font-bold text-sos-dark">{t('This sounds serious. Open Emergency now or call 108.')}</p>
          <div className="flex flex-wrap gap-2">
            <Link to="/emergency" className="btn-sos">
              <Icon name="alert" /> {t('Open emergency help')}
            </Link>
            <a href="tel:108" className="btn-outline">
              <Icon name="phone" /> 108
            </a>
          </div>
        </div>
      )}

      {state === 'searching' && (
        <div className="mt-4 grid gap-3" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-28 rounded-3xl" />
          ))}
        </div>
      )}

      {options && state !== 'searching' && (
        <section className="mt-5" aria-live="polite">
          <h2 className="mb-3 text-lg font-bold">
            {dept ? t('Earliest doctors · {{dept}}', { dept: deptLabel(dept) }) : t('Earliest doctors')}
          </h2>
          {options.length === 0 && <p className="card p-5 text-muted">{t('Sorry, no free doctor found. Try another hospital type.')}</p>}
          <ul className="grid gap-3">
            {options.map((o, i) => (
              <li key={o.slot_id} className={`card fade-up flex flex-col gap-3 p-4 sm:flex-row sm:items-center ${i === 0 ? 'border-2 border-brand' : ''}`}>
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {o.photo_url ? (
                    <img src={o.photo_url} alt="" width={56} height={56} loading="lazy" className="size-14 shrink-0 rounded-full object-cover ring-2 ring-brand-soft" />
                  ) : (
                    <span className="grid size-14 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
                      <Icon name="user" />
                    </span>
                  )}
                  <div className="min-w-0">
                    {i === 0 && <span className="mb-1 inline-block rounded-full bg-leaf-soft px-2.5 py-0.5 text-xs font-bold text-leaf-dark">{t('Fastest')}</span>}
                    <p className="font-semibold">{o.doctor_name}</p>
                    <p className="truncate text-sm text-muted">
                      {o.hospital_name} · {o.distance_km} km
                    </p>
                    <p className="text-[15px] font-semibold text-brand-dark">
                      <Icon name="clock" size={16} className="mr-1 inline align-[-2px]" />
                      {formatDateTime(o.starts_at)} · {o.fee_inr ? `₹${o.fee_inr}` : t('Free')}
                    </p>
                  </div>
                </div>
                <button type="button" className="btn-primary sm:w-auto" disabled={busy} onClick={() => book(o)}>
                  {state === 'booking' ? t('Booking…') : t('Book this')}
                </button>
              </li>
            ))}
          </ul>
          <Link to={visitType === 'video' ? '/book?visit=video' : '/book'} className="mt-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-brand">
            {t('Choose hospital and doctor myself')} <Icon name="right" size={18} />
          </Link>
        </section>
      )}
    </div>
  );
}
