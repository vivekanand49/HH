import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { isUrgent } from '@swasthya/shared/triage';
import { chatReply } from '@swasthya/shared/chat';
import Icon from '../components/Icon';
import { api } from '../lib/api';
import { deptLabel } from '../lib/labels';
import { canListen, listenOnce, speak, stopListening, stopSpeaking } from '../lib/speech';
import { LANGUAGES } from '../i18n';

const SEVERITY_STYLE = {
  critical: 'bg-sos text-white',
  high: 'bg-urgent text-white',
  medium: 'bg-warn-soft text-warn',
  low: 'bg-leaf-soft text-leaf-dark',
};

export default function Assistant() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const online = useSelector((s) => s.network.online);
  // { role, content, severity?, source?, department?, quickReplies?, book? }
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  // Talk mode: replies are read aloud and the mic opens again, hands-free.
  const [talking, setTalking] = useState(false);
  const talkingRef = useRef(false);
  const [conversationId, setConversationId] = useState(null);
  const endRef = useRef(null);
  const lang = LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0];

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [messages, busy]);
  useEffect(
    () => () => {
      talkingRef.current = false;
      stopListening();
      stopSpeaking();
    },
    [],
  );

  async function reply(history) {
    // Offline, the same chat runs on the phone (urgent symptoms are answered there too).
    if (!online) return { ...chatReply(history, lang.code), source: 'offline' };
    try {
      const res = await api('/ai/chat', {
        method: 'POST',
        timeout: 60000,
        body: { conversationId: conversationId ?? undefined, language: lang.code, messages: history.map(({ role, content }) => ({ role, content })) },
      });
      setConversationId(res.conversationId);
      return res;
    } catch {
      return { ...chatReply(history, lang.code), source: 'offline' };
    }
  }

  async function ask(text) {
    const content = text.trim();
    if (!content || busy) return;
    const history = [...messages, { role: 'user', content }];
    setMessages(history);
    setInput('');
    setBusy(true);
    const answer = await reply(history);
    setBusy(false);
    setMessages([...history, { role: 'assistant', ...answer, content: answer.reply }]);
    if (talkingRef.current) {
      await speak(answer.reply, lang.speech);
      if (talkingRef.current && !isUrgent(answer.severity) && !answer.book) listen();
      else stopTalking();
    }
  }

  async function listen() {
    setListening(true);
    const said = await listenOnce(lang.speech);
    setListening(false);
    if (said) ask(said);
    else stopTalking();
  }

  function startTalking() {
    talkingRef.current = true;
    setTalking(true);
    stopSpeaking();
    listen();
  }

  function stopTalking() {
    talkingRef.current = false;
    setTalking(false);
    setListening(false);
    stopListening();
    stopSpeaking();
  }

  function bookFastest(m) {
    const said = messages.filter((x) => x.role === 'user').map((x) => x.content).join('. ');
    navigate(`/quick-book?dept=${m.department ?? 'general'}&q=${encodeURIComponent(said.slice(0, 300))}`);
  }

  const suggestions = [t('I have fever and headache'), t('My sugar is high'), t('Book a doctor for my child'), t('How should I take my medicine?')];
  const lastIndex = messages.length - 1;

  return (
    <div className="mx-auto flex h-[calc(100dvh-11rem)] max-w-3xl flex-col md:h-[calc(100dvh-4rem)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <img src="/img/doctor-3.jpg" alt="" width={56} height={56} className="size-14 shrink-0 rounded-full object-cover ring-4 ring-accent-soft" />
          <div>
            <h1 className="text-[26px] font-bold">{t('Health assistant')}</h1>
            <p className={`flex items-center gap-1.5 text-sm font-semibold ${online ? 'text-leaf-dark' : 'text-warn'}`}>
              <span className={`status-dot ${online ? 'bg-leaf' : 'bg-warn'}`} aria-hidden="true" />
              {online ? t('Online · full assistant') : t('Offline · on-phone checker')}
            </p>
          </div>
        </div>
        <span className="chip">
          {t('Replies in')} {lang.native}
        </span>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain rounded-3xl border border-line bg-surface p-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="py-6 text-center text-muted">
            <span className="mx-auto mb-3 grid size-14 place-items-center rounded-full bg-accent-soft text-accent">
              <Icon name="chat" size={28} />
            </span>
            <p className="mb-4 text-[15px]">{t('Tell me how you feel, in your own words. You can type or speak.')}</p>
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
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {isUrgent(m.severity) && (
                    <Link to="/emergency" className="btn-sos min-h-11 text-[15px]">
                      <Icon name="alert" size={18} /> {t('Open emergency help')}
                    </Link>
                  )}
                  {m.book && !isUrgent(m.severity) && (
                    <>
                      <button type="button" className="btn-primary min-h-11 text-[15px]" onClick={() => bookFastest(m)}>
                        <Icon name="calendar" size={18} /> {t('Book fastest slot')}
                      </button>
                      {m.department && <span className="text-xs font-semibold text-muted">{deptLabel(m.department)}</span>}
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => speak(m.content, lang.speech)}
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

      {talking && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-brand-soft px-4 py-2.5 text-[15px] font-semibold text-brand-dark" role="status">
          <span className="flex items-center gap-2">
            <span className={`status-dot ${listening ? 'bg-sos' : 'bg-brand'}`} aria-hidden="true" />
            {listening ? t('Listening… speak now') : t('Talk mode on: I will read my answers aloud')}
          </span>
          <button type="button" className="btn-outline min-h-10 px-3 text-sm" onClick={stopTalking}>
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
            onClick={talking ? stopTalking : startTalking}
            aria-pressed={talking}
            aria-label={talking ? t('Stop talking') : t('Talk to the assistant')}
            className={`grid size-14 shrink-0 place-items-center rounded-full transition-colors ${listening ? 'mic-live bg-sos text-white' : talking ? 'bg-brand text-white' : 'bg-brand-soft text-brand hover:bg-brand hover:text-white'}`}
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
