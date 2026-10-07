import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { isUrgent } from '@swasthya/shared/triage';
import { chatReply, dayFromText } from '@swasthya/shared/chat';
import Icon from '../components/Icon';
import { api } from '../lib/api';
import { bookOption, findFastest } from '../lib/booking';
import { deptLabel } from '../lib/labels';
import { getLocation } from '../lib/location';
import { canListen, listenOnce, speak, stopListening, stopSpeaking, VOICE_ERRORS, yesNo } from '../lib/speech';
import { formatDateTime, LANGUAGES } from '../i18n';

const SEVERITY_STYLE = {
  critical: 'bg-sos text-white',
  high: 'bg-urgent text-white',
  medium: 'bg-warn-soft text-warn',
  low: 'bg-leaf-soft text-leaf-dark',
};

function savedVoiceReplies() {
  try {
    return localStorage.getItem('assistant.voice') === '1';
  } catch {
    return false;
  }
}

// Four ways to talk: type or speak, and read or hear the answer ("Speak answers").
// Speaking with "Speak answers" on is hands-free: the mic opens again after each answer.
export default function Assistant() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const online = useSelector((s) => s.network.online);
  const user = useSelector((s) => s.session.user);
  // { role, content, severity?, source?, department?, quickReplies?, book?, options? }
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState('idle'); // idle | listening | speaking
  const [voiceReplies, setVoiceReplies] = useState(savedVoiceReplies);
  const [voiceError, setVoiceError] = useState(null);
  const [booking, setBooking] = useState(null); // slot_id being booked
  // Refs: the hands-free loop calls ask() again from an older render.
  const messagesRef = useRef([]);
  const conversationId = useRef(null);
  const voiceRepliesRef = useRef(voiceReplies);
  const handsFree = useRef(false);
  const alive = useRef(true);
  const loc = useRef(user?.lat != null ? { lat: user.lat, lng: user.lng } : null);
  const endRef = useRef(null);
  const lang = LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0];

  // Braces matter: newer Chrome returns a Promise from scrollIntoView, and an
  // effect must return nothing or a cleanup function (else the page goes blank).
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);
  useEffect(() => {
    alive.current = true;
    getLocation({ timeout: 8000 }).then((l) => l && (loc.current = l));
    return () => {
      alive.current = false;
      handsFree.current = false;
      stopListening();
      stopSpeaking();
    };
  }, []);

  function setMsgs(next) {
    messagesRef.current = next;
    setMessages(next);
  }

  function toggleVoiceReplies() {
    const next = !voiceReplies;
    voiceRepliesRef.current = next;
    setVoiceReplies(next);
    if (!next) stopAll();
    try {
      localStorage.setItem('assistant.voice', next ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  async function reply(history) {
    // Offline, the same chat runs on the phone (urgent symptoms are answered there too).
    if (!online) return { ...chatReply(history, lang.code), source: 'offline' };
    try {
      const res = await api('/ai/chat', {
        method: 'POST',
        timeout: 45000,
        body: { conversationId: conversationId.current ?? undefined, language: lang.code, messages: history.map(({ role, content }) => ({ role, content })) },
      });
      conversationId.current = res.conversationId;
      return res;
    } catch {
      return { ...chatReply(history, lang.code), source: 'offline' };
    }
  }

  async function say(text) {
    setVoice('speaking');
    const out = await speak(text, lang.speech);
    if (!alive.current) return false;
    setVoice('idle');
    if (!out.ok) setVoiceError({ code: out.error });
    return out.ok;
  }

  const said = (history) =>
    history
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('. ');

  async function ask(text, { spoken = false } = {}) {
    const content = text.trim();
    if (!content || busy) return;
    setVoiceError(null);
    const history = [...messagesRef.current, { role: 'user', content }];
    setMsgs(history);
    setInput('');
    setBusy(true);
    const answer = await reply(history);
    // "Book fastest slot": find the earliest doctors right here in the chat.
    let options = null;
    if (answer.book && !isUrgent(answer.severity) && online) {
      options = await findFastest({ department: answer.department ?? 'general', day: dayFromText(said(history)), loc: loc.current }).catch(() => null);
    }
    if (!alive.current) return;
    setBusy(false);
    const message = { role: 'assistant', ...answer, content: answer.reply, options };
    setMsgs([...history, message]);

    handsFree.current = spoken && voiceRepliesRef.current;
    if (!voiceRepliesRef.current) return;
    const ok = await say(answer.reply);
    if (!ok || !handsFree.current || !alive.current) return;
    if (options?.length) return confirmByVoice(options, 0, said(history));
    if (!isUrgent(answer.severity)) listen();
  }

  // Reads an option aloud and books it on "yes"; "no" moves to the next one.
  async function confirmByVoice(options, i, complaint) {
    const o = options[i];
    if (!o || !handsFree.current) return;
    const time = formatDateTime(o.starts_at, { weekday: 'long', hour: 'numeric', minute: '2-digit' });
    if (!(await say(t('{{doctor}} at {{hospital}}, {{time}}. Say yes to book, or no for the next one.', { doctor: o.doctor_name, hospital: o.hospital_name, time }))))
      return;
    if (!handsFree.current) return;
    setVoice('listening');
    const heard = await listenOnce(lang.speech);
    if (!alive.current) return;
    setVoice('idle');
    const answer = yesNo(heard.text);
    if (answer === 'yes') return book(o, complaint);
    if (answer === 'no' && options[i + 1]) return confirmByVoice(options, i + 1, complaint);
    if (!heard.text) setVoiceError({ code: heard.error, detail: heard.detail });
  }

  async function book(o, complaint) {
    stopAll();
    setBooking(o.slot_id);
    try {
      const appointment = await bookOption(o, { complaint });
      navigate(`/appointments/${appointment.id}`, { state: { justBooked: true } });
    } catch (err) {
      if (!alive.current) return;
      setBooking(null);
      setMsgs([...messagesRef.current, { role: 'assistant', content: err.status === 409 ? t('That time was just taken. Please pick another.') : err.message }]);
    }
  }

  async function listen() {
    stopSpeaking();
    setVoiceError(null);
    setVoice('listening');
    const heard = await listenOnce(lang.speech, { onPartial: setInput });
    if (!alive.current) return;
    setVoice('idle');
    if (heard.text) ask(heard.text, { spoken: true });
    else {
      handsFree.current = false;
      if (heard.error !== 'silent' || messagesRef.current.length === 0) setVoiceError({ code: heard.error, detail: heard.detail });
    }
  }

  function stopAll() {
    handsFree.current = false;
    stopListening();
    stopSpeaking();
    setVoice('idle');
  }

  const suggestions = [t('I have fever and headache'), t('My sugar is high'), t('Book a doctor for my child'), t('How should I take my medicine?')];
  const lastIndex = messages.length - 1;

  return (
    <div className="mx-auto flex h-[calc(100dvh-11rem)] max-w-3xl flex-col md:h-[calc(100dvh-4rem)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <img src="/img/doctor-3.jpg" alt="" width={56} height={56} className="size-14 shrink-0 rounded-full object-cover ring-4 ring-accent-soft" />
          <div className="min-w-0">
            <h1 className="text-[26px] font-bold">{t('Health assistant')}</h1>
            <p className={`flex items-center gap-1.5 text-sm font-semibold ${online ? 'text-leaf-dark' : 'text-warn'}`}>
              <span className={`status-dot ${online ? 'bg-leaf' : 'bg-warn'}`} aria-hidden="true" />
              {online ? t('Online · full assistant') : t('Offline · on-phone checker')} · {lang.native}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={toggleVoiceReplies}
          aria-pressed={voiceReplies}
          className={`chip shrink-0 gap-1.5 ${voiceReplies ? 'border-brand bg-brand text-white hover:border-brand' : ''}`}
        >
          <Icon name="speaker" size={18} /> {voiceReplies ? t('Speak answers: on') : t('Speak answers: off')}
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain rounded-3xl border border-line bg-surface p-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="py-6 text-center text-muted">
            <span className="mx-auto mb-3 grid size-14 place-items-center rounded-full bg-accent-soft text-accent">
              <Icon name="chat" size={28} />
            </span>
            <p className="mb-1 text-[15px]">{t('Tell me how you feel, in your own words. You can type or speak.')}</p>
            <p className="mb-4 text-sm">{t('Turn on “Speak answers” to hear my replies. Tap the mic to talk hands-free.')}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button key={s} type="button" className="chip lift" onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <p key={i} className="bubble-in ml-auto w-fit max-w-[85%] rounded-3xl rounded-br-md bg-brand px-4 py-2.5 text-[15px] text-white">
              {m.content}
            </p>
          ) : (
            <div key={i} className="bubble-in flex max-w-[92%] gap-2">
              <span className="mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent" aria-hidden="true">
                <Icon name="chat" size={16} />
              </span>
              <div className={`min-w-0 rounded-3xl rounded-tl-md border p-4 ${isUrgent(m.severity) ? 'border-2 border-sos bg-sos-bg' : 'border-line bg-bg'}`}>
                {m.severity && m.severity !== 'low' && (
                  <span className={`mb-2 inline-block rounded-full px-2.5 py-1 text-xs font-bold uppercase ${SEVERITY_STYLE[m.severity]}`}>
                    {t(`severity_${m.severity}`)}
                  </span>
                )}
                <p className="text-[15px] leading-relaxed whitespace-pre-line">{m.content}</p>

                {m.options?.length > 0 && (
                  <ul className="mt-3 grid gap-2">
                    {m.options.map((o, j) => (
                      <li key={o.slot_id} className={`card flex flex-wrap items-center gap-3 p-3 ${j === 0 ? 'border-2 border-brand' : ''}`}>
                        <div className="min-w-0 flex-1">
                          {j === 0 && <span className="mb-1 inline-block rounded-full bg-leaf-soft px-2 py-0.5 text-xs font-bold text-leaf-dark">{t('Fastest')}</span>}
                          <p className="font-semibold">{o.doctor_name}</p>
                          <p className="truncate text-sm text-muted">
                            {o.hospital_name} · {o.distance_km} km
                          </p>
                          <p className="text-sm font-semibold text-brand-dark">
                            {formatDateTime(o.starts_at)} · {o.fee_inr ? `₹${o.fee_inr}` : t('Free')}
                          </p>
                        </div>
                        <button type="button" className="btn-primary min-h-11 text-[15px]" disabled={Boolean(booking)} onClick={() => book(o, said(messages.slice(0, i)))}>
                          {booking === o.slot_id ? t('Booking…') : t('Book this')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {isUrgent(m.severity) && (
                    <Link to="/emergency" className="btn-sos min-h-11 text-[15px]">
                      <Icon name="alert" size={18} /> {t('Open emergency help')}
                    </Link>
                  )}
                  {m.book && !isUrgent(m.severity) && (
                    <>
                      {!m.options?.length && (
                        <Link
                          to={`/quick-book?dept=${m.department ?? 'general'}&q=${encodeURIComponent(said(messages.slice(0, i)).slice(0, 300))}`}
                          className="btn-primary min-h-11 text-[15px]"
                        >
                          <Icon name="calendar" size={18} /> {t('Book fastest slot')}
                        </Link>
                      )}
                      {m.department && <span className="text-xs font-semibold text-muted">{deptLabel(m.department)}</span>}
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => say(m.content)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-brand hover:bg-brand-soft"
                    aria-label={t('Read aloud')}
                  >
                    <Icon name="speaker" size={18} /> {t('Listen')}
                  </button>
                  {m.source === 'offline' && <span className="text-xs text-muted">{t('Answered on your phone (offline)')}</span>}
                </div>
                {i === lastIndex && m.quickReplies?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t('Quick answers')}>
                    {m.quickReplies.map((q) => (
                      <button key={q} type="button" className="chip lift border-brand/40 text-brand-dark" onClick={() => ask(q)} disabled={busy}>
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted" role="status">
            <span className="typing" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            {t('Thinking…')}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {voiceError && (
        <p className="mt-3 flex items-start justify-between gap-3 rounded-2xl bg-warn-soft px-4 py-2.5 text-[15px] text-warn" role="status">
          <span>
            {t(VOICE_ERRORS[voiceError.code])}
            {voiceError.detail && <span className="ml-1 text-xs opacity-70">({voiceError.detail})</span>}
          </span>
          <button type="button" className="shrink-0 font-semibold" onClick={() => setVoiceError(null)} aria-label={t('Close')}>
            <Icon name="close" size={18} />
          </button>
        </p>
      )}
      {voice !== 'idle' && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-brand-soft px-4 py-2.5 text-[15px] font-semibold text-brand-dark" role="status">
          <span className="flex items-center gap-2">
            <span className={`status-dot ${voice === 'listening' ? 'bg-sos' : 'bg-brand'}`} aria-hidden="true" />
            {voice === 'listening' ? t('Listening… speak now') : t('Speaking…')}
          </span>
          <button type="button" className="btn-outline min-h-10 px-3 text-sm" onClick={stopAll}>
            {t('Stop')}
          </button>
        </div>
      )}

      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <label htmlFor="msg" className="sr-only">
          {t('Type your message')}
        </label>
        <input
          id="msg"
          className="input min-w-0 flex-1 text-base"
          placeholder={canListen ? t('Type or tap the mic to speak') : t('Type your message')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={2000}
        />
        {canListen && (
          <button
            type="button"
            onClick={voice === 'listening' ? stopAll : listen}
            disabled={busy}
            aria-pressed={voice === 'listening'}
            aria-label={voice === 'listening' ? t('Stop listening') : t('Talk to the assistant')}
            className={`grid size-14 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-50 ${voice === 'listening' ? 'mic-live bg-sos text-white' : 'bg-brand-soft text-brand hover:bg-brand hover:text-white'}`}
          >
            <Icon name="mic" />
          </button>
        )}
        <button
          type="submit"
          aria-label={t('Send')}
          className="grid size-14 shrink-0 place-items-center rounded-full bg-brand text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
          disabled={!input.trim() || busy}
        >
          <Icon name="send" />
        </button>
      </form>
      <p className="mt-2 text-center text-xs text-muted">{t('Not a diagnosis. In an emergency call 108.')}</p>
    </div>
  );
}
