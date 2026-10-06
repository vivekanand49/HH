// Speech in the browser: listening (speech-to-text) and reading aloud.
// Chrome on Android supports en-IN, te-IN, hi-IN and mr-IN; where listening is
// not supported the screens fall back to typing.
const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export const canListen = Boolean(Recognition);

let current = null;

/** Listens for one sentence. Resolves with the text, or null if nothing was heard. */
export function listenOnce(lang) {
  return new Promise((resolve) => {
    if (!Recognition) return resolve(null);
    stopListening();
    const rec = new Recognition();
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let text = null;
    rec.onresult = (e) => {
      text = e.results[0]?.[0]?.transcript?.trim() || null;
    };
    rec.onerror = () => {}; // onend always follows
    rec.onend = () => {
      if (current === rec) current = null;
      resolve(text);
    };
    current = rec;
    try {
      rec.start();
    } catch {
      current = null;
      resolve(null);
    }
  });
}

export function stopListening() {
  current?.abort();
  current = null;
}

/** Reads text aloud; resolves when finished (or at once if not supported). */
export function speak(text, lang) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return resolve();
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
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
