// Speech for the assistant and voice booking, in English, Telugu, Hindi and Marathi.
//  - Listening (speech-to-text): the browser's own recognition (Chrome, Safari); if the
//    browser has none, or it fails, the phone records and the server's Bhashini transcribes.
//  - Speaking (text-to-speech): a phone voice in the right language; if the phone has
//    none (common for Telugu and Marathi), Bhashini on the server speaks instead.
// Every call reports a clear error code so the screen can tell people what to do.
import { api, apiBlob, apiUpload } from './api';

const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const canRecord = typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

/** true if this browser can take voice input in some way. */
export const canListen = Boolean(Recognition) || canRecord;

let server = null; // { tts, stt } from /speech/config
async function serverVoice() {
  if (!server) server = api('/speech/config').catch(() => ({ tts: false, stt: false }));
  return server;
}

const code = (locale) => locale.slice(0, 2);
let current = null; // { abort() } for whatever is listening or speaking now

/**
 * Listens for one sentence.
 * @returns {Promise<{ text: string|null, error: null|'denied'|'silent'|'network'|'unsupported'|'failed' }>}
 */
export async function listenOnce(locale) {
  stopListening();
  if (Recognition) {
    const out = await browserListen(locale);
    if (out.text || !['network', 'unsupported', 'failed'].includes(out.error)) return out;
  }
  if (canRecord && (await serverVoice()).stt) return serverListen(locale);
  return { text: null, error: Recognition ? 'network' : 'unsupported' };
}

function browserListen(locale) {
  return new Promise((resolve) => {
    const rec = new Recognition();
    rec.lang = locale;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let text = null;
    let error = null;
    rec.onresult = (e) => {
      text = e.results[0]?.[0]?.transcript?.trim() || null;
    };
    rec.onerror = (e) => {
      error =
        {
          'not-allowed': 'denied',
          'service-not-allowed': 'denied',
          'audio-capture': 'denied',
          'no-speech': 'silent',
          aborted: 'silent',
          network: 'network',
          'language-not-supported': 'unsupported',
        }[e.error] ?? 'failed';
    };
    // Some browsers never end on their own (no network to the speech service, a
    // muted mic): stop after 12 s, and give up entirely after 20 s.
    const soft = setTimeout(() => rec.stop(), 12000);
    const hard = setTimeout(() => {
      error ??= 'network';
      rec.abort();
      finish();
    }, 20000);
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      clearTimeout(soft);
      clearTimeout(hard);
      if (current?.rec === rec) current = null;
      resolve({ text, error: text ? null : (error ?? 'silent') });
    }
    rec.onspeechend = () => rec.stop();
    rec.onend = finish;
    current = { rec, abort: () => rec.abort() };
    try {
      rec.start();
    } catch {
      current = null;
      resolve({ text: null, error: 'failed' });
    }
  });
}

function pickMime() {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return '';
}

// Records until the person stops talking (1.5 s of quiet), at most 12 s, then
// sends the audio to the server for speech-to-text.
async function serverListen(locale) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return { text: null, error: 'denied' };
  }
  const mime = pickMime();
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = Ctx ? new Ctx() : null;
  const analyser = ctx?.createAnalyser();
  if (ctx) ctx.createMediaStreamSource(stream).connect(analyser);
  const samples = new Uint8Array(1024);

  const blob = await new Promise((resolve) => {
    const start = Date.now();
    let heard = !ctx; // without an AudioContext, just record the full time
    let quietSince = start;
    let aborted = false;
    const tick = setInterval(() => {
      const now = Date.now();
      if (analyser) {
        analyser.getByteTimeDomainData(samples);
        let peak = 0;
        for (const v of samples) peak = Math.max(peak, Math.abs(v - 128));
        if (peak > 14) {
          heard = true;
          quietSince = now;
        }
      }
      if ((heard && now - quietSince > 1500) || (!heard && now - start > 6000) || now - start > 12000) stop();
    }, 100);
    function stop() {
      clearInterval(tick);
      if (recorder.state !== 'inactive') recorder.stop();
    }
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      ctx?.close();
      if (current?.recorder === recorder) current = null;
      resolve(heard && !aborted && chunks.length ? new Blob(chunks, { type: (recorder.mimeType || mime || 'audio/webm').split(';')[0] }) : null);
    };
    current = {
      recorder,
      abort: () => {
        aborted = true;
        stop();
      },
    };
    recorder.start(250);
  });
  if (!blob) return { text: null, error: 'silent' };
  try {
    const { text } = await apiUpload(`/speech/stt?lang=${code(locale)}`, blob, { timeout: 45000 });
    return text ? { text, error: null } : { text: null, error: 'silent' };
  } catch (err) {
    return { text: null, error: err.status === 0 ? 'network' : 'failed' };
  }
}

export function stopListening() {
  current?.abort();
  current = null;
}

// ---------- Speaking ----------

function voices() {
  return new Promise((resolve) => {
    const now = window.speechSynthesis.getVoices();
    if (now.length) return resolve(now);
    const done = () => resolve(window.speechSynthesis.getVoices());
    window.speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1200); // some browsers never fire the event
  });
}

async function phoneVoice(locale) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const all = await voices();
  const want = locale.toLowerCase();
  const norm = (v) => v.lang.toLowerCase().replace('_', '-');
  return all.find((v) => norm(v) === want) ?? all.find((v) => norm(v).startsWith(`${code(want)}-`) || norm(v) === code(want)) ?? null;
}

// Short pieces: long texts make some phones stop speaking half-way.
function pieces(text, max = 220) {
  const clean = text.replace(/[*_#>`]/g, '').replace(/\s+/g, ' ').trim();
  const out = [];
  for (const sentence of clean.split(/(?<=[.!?।])\s+/)) {
    const last = out.at(-1);
    if (last && last.length + sentence.length + 1 <= max) out[out.length - 1] = `${last} ${sentence}`;
    else out.push(sentence.length > max ? sentence.slice(0, max) : sentence);
  }
  return out.filter(Boolean);
}

let audio = null;
let speakToken = null; // a new object per speak(); stopSpeaking() clears it

/**
 * Reads the text aloud.
 * @returns {Promise<{ ok: boolean, error: null|'no-voice'|'network' }>}
 */
export async function speak(text, locale) {
  stopSpeaking();
  const parts = pieces(text);
  const voice = await phoneVoice(locale);
  if (voice) {
    const token = (speakToken = {});
    for (const part of parts) {
      if (speakToken !== token) break;
      await new Promise((resolve) => {
        const u = new SpeechSynthesisUtterance(part);
        u.lang = voice.lang;
        u.voice = voice;
        u.onend = u.onerror = () => resolve();
        window.speechSynthesis.speak(u);
      });
    }
    return { ok: true, error: null };
  }
  if ((await serverVoice()).tts) {
    const token = (speakToken = {});
    try {
      for (const part of parts) {
        if (speakToken !== token) break;
        const blob = await apiBlob('/speech/tts', { text: part.slice(0, 600), lang: code(locale) });
        if (speakToken !== token) break;
        const url = URL.createObjectURL(blob);
        audio = new Audio(url);
        await new Promise((resolve) => {
          audio.onended = audio.onerror = audio.onpause = () => resolve();
          audio.play().catch(resolve);
        });
        URL.revokeObjectURL(url);
      }
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: err.status === 0 ? 'network' : 'no-voice' };
    }
  }
  return { ok: false, error: 'no-voice' };
}

export function stopSpeaking() {
  speakToken = null;
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  audio?.pause();
  audio = null;
}

const YES = new Set(['yes', 'yeah', 'yep', 'ok', 'okay', 'book', 'confirm', 'sure', 'అవును', 'సరే', 'ఓకే', 'హా', 'हाँ', 'हां', 'हा', 'जी', 'ठीक', 'होय', 'हो']);
const NO = new Set(['no', 'next', 'other', 'another', 'వద్దు', 'కాదు', 'వేరే', 'नहीं', 'नही', 'दूसरा', 'अगला', 'नको', 'दुसरा', 'नाही']);

/** 'yes', 'no' or null for a spoken answer in any of the four languages. */
export function yesNo(text) {
  const words = String(text || '')
    .toLowerCase()
    .split(/[\s,.!?।]+/);
  if (words.some((w) => NO.has(w))) return 'no';
  if (words.some((w) => YES.has(w))) return 'yes';
  return null;
}

/** Text for an error code, in English (the screens translate it with t()). */
export const VOICE_ERRORS = {
  denied: 'The microphone is blocked. Allow the microphone for this site in your browser settings.',
  silent: 'I did not hear anything. Tap the mic and speak again.',
  network: 'Voice needs internet. Please check your connection, or type instead.',
  unsupported: 'Voice typing does not work in this browser. Please type, or open the app in Chrome.',
  failed: 'Voice did not work this time. Please try again or type.',
  'no-voice': 'This phone has no voice for this language. Install “Speech Services by Google” and its voice for your language, or read the answer.',
};
