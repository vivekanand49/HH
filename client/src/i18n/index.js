// Keys are the English text itself, so English needs no file and a missing
// translation shows English instead of a broken key.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import te from './locales/te.json';
import hi from './locales/hi.json';
import mr from './locales/mr.json';

export const LANGUAGES = [
  { code: 'en', native: 'English', english: 'English', locale: 'en-IN', speech: 'en-IN' },
  { code: 'te', native: 'తెలుగు', english: 'Telugu', locale: 'te-IN', speech: 'te-IN' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi', locale: 'hi-IN', speech: 'hi-IN' },
  { code: 'mr', native: 'मराठी', english: 'Marathi', locale: 'mr-IN', speech: 'mr-IN' },
];

function savedLanguage() {
  try {
    return localStorage.getItem('lang');
  } catch {
    return null;
  }
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, te: { translation: te }, hi: { translation: hi }, mr: { translation: mr } },
  lng: savedLanguage() || 'en',
  fallbackLng: 'en',
  keySeparator: false,
  nsSeparator: false,
  returnEmptyString: false,
  interpolation: { escapeValue: false },
});

export function hasChosenLanguage() {
  return Boolean(savedLanguage());
}

export function setLanguage(code) {
  i18n.changeLanguage(code);
  document.documentElement.lang = code;
  try {
    localStorage.setItem('lang', code);
  } catch {
    /* ignore */
  }
}

document.documentElement.lang = i18n.language;

export function localeOf(code = i18n.language) {
  return LANGUAGES.find((l) => l.code === code)?.locale ?? 'en-IN';
}

export function formatDateTime(value, opts = { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) {
  return new Date(value).toLocaleString(localeOf(), { timeZone: 'Asia/Kolkata', ...opts });
}

export default i18n;
