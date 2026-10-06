import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { triage, offlineAdvice, isUrgent } from '@swasthya/shared/triage';
import Icon from '../components/Icon';
import { api } from '../lib/api';
import { LANGUAGES } from '../i18n';

const SpeechRecognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

const SEVERITY_STYLE = {
  critical: 'bg-sos text-white',
  high: 'bg-urgent text-white',
  medium: 'bg-warn-soft text-warn',
  low: 'bg-leaf-soft text-leaf-dark',
};

export default function Assistant() {
  const { t, i18n } = useTranslation();
  const online = useSelector((s) => s.network.online);
  const [messages, setMessages] = useState([]); // { role, content, severity?, source? }
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const endRef = useRef(null);
  const lang = LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0];

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [messages]);

  async function ask(text) {
    const content = text.trim();
    if (!content || busy) return;
    const history = [...messages, { role: 'user', content }];
    setMessages(history);
    setInput('');

    // Urgent symptoms are answered on the phone instantly, online or not.
    const local = triage(content);
    if (!online || isUrgent(local.severity)) {
      setMessages([
        ...history,
        { role: 'assistant', content: offlineAdvice(local.severity, lang.code), severity: local.severity, source: online ? 'triage' : 'offline' },
      ]);
      return;
    }

    setBusy(true);
    try {
      const res = await api('/ai/chat', {
        method: 'POST',
        timeout: 60000,
        body: { conversationId: conversationId ?? undefined, language: lang.code, messages: history.map(({ role, content: c }) => ({ role, content: c })) },
      });
      setConversationId(res.conversationId);
      setMessages([...history, { role: 'assistant', content: res.reply, severity: res.severity, source: res.source }]);
    } catch {
      setMessages([...history, { role: 'assistant', content: offlineAdvice(local.severity, lang.code), severity: local.severity, source: 'offline' }]);
    } finally {
      setBusy(false);
    }
  }

  function listen() {
    if (!SpeechRecognition) return;
    const rec = new SpeechRecognition();
    rec.lang = lang.speech;
    rec.interimResults = false;
    rec.onresult = (e) => ask(e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    rec.start();
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang.speech;
    window.speechSynthesis.speak(u);
  }

  const suggestions = [t('I have fever and headache'), t('My sugar is high'), t('How should I take my medicine?')];

  return (
    <div className="mx-auto flex h-[calc(100dvh-11rem)] max-w-3xl flex-col md:h-[calc(100dvh-4rem)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <img src="/img/doctor-3.jpg" alt="" width={56} height={56} className="size-14 shrink-0 rounded-full object-cover ring-4 ring-accent-soft" />
          <div>
            <h1 className="text-[26px] font-bold">{t('Health assistant')}</h1>
            <p className={`text-sm font-semibold ${online ? 'text-leaf-dark' : 'text-warn'}`}>
              ● {online ? t('Online · full assistant') : t('Offline · on-phone checker')}
            </p>
          </div>
        </div>
        <span className="chip">
          {t('Replies in')} {lang.native}
        </span>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto rounded-3xl border border-line bg-surface p-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="py-6 text-center text-muted">
            <p className="mb-4">{t('Tell me how you feel, in your own words. You can type or speak.')}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <p key={i} className="ml-auto max-w-[85%] rounded-3xl rounded-br-md bg-brand px-4 py-2.5 text-[15px] text-white">
              {m.content}
            </p>
          ) : (
            <div key={i} className={`max-w-[92%] rounded-3xl rounded-bl-md border p-4 ${isUrgent(m.severity) ? 'border-2 border-sos' : 'border-line bg-bg'}`}>
              {m.severity && (
                <span className={`mb-2 inline-block rounded-full px-2.5 py-1 text-xs font-bold uppercase ${SEVERITY_STYLE[m.severity]}`}>
                  {t(`severity_${m.severity}`)}
                </span>
              )}
              <p className="text-[15px] whitespace-pre-line">{m.content}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {isUrgent(m.severity) && (
                  <Link to="/emergency" className="btn-sos min-h-11 text-[15px]">
                    {t('Open emergency help')}
                  </Link>
                )}
                {m.severity === 'medium' && (
                  <Link to="/book" className="btn-primary min-h-11 text-[15px]">
                    {t('Book doctor')}
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => speak(m.content)}
                  className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand"
                  aria-label={t('Read aloud')}
                >
                  <Icon name="speaker" size={18} /> {t('Listen')}
                </button>
                {m.source === 'offline' && <span className="text-xs text-muted">{t('Answered on your phone (offline)')}</span>}
              </div>
            </div>
          ),
        )}
        {busy && <p className="text-sm text-muted">{t('Thinking…')}</p>}
        <div ref={endRef} />
      </div>

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
          placeholder={t('Type or tap the mic to speak')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={2000}
        />
        {SpeechRecognition && online && (
          <button
            type="button"
            onClick={listen}
            aria-label={t('Speak')}
            className={`grid size-14 shrink-0 place-items-center rounded-full ${listening ? 'bg-sos text-white' : 'bg-brand-soft text-brand'}`}
          >
            <Icon name="mic" />
          </button>
        )}
        <button
          type="submit"
          aria-label={t('Send')}
          className="grid size-14 shrink-0 place-items-center rounded-full bg-brand text-white disabled:opacity-50"
          disabled={!input.trim() || busy}
        >
          <Icon name="send" />
        </button>
      </form>
      <p className="mt-2 text-center text-xs text-muted">{t('Not a diagnosis. In an emergency call 108.')}</p>
    </div>
  );
}
