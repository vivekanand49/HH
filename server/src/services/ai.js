// Health assistant. Safety first: the rule-based triage runs before any AI
// call, and urgent symptoms get the emergency answer immediately.
import Anthropic from '@anthropic-ai/sdk';
import { triage, offlineAdvice, isUrgent } from '@swasthya/shared/triage';
import { chatReply } from '@swasthya/shared/chat';
import { config } from '../config.js';

const LANGUAGE_NAMES = { en: 'English', te: 'Telugu', hi: 'Hindi', mr: 'Marathi' };
const MODEL = 'claude-opus-5';

let client = null;
function getClient() {
  if (!config.anthropicKey) return null;
  client ??= new Anthropic({ apiKey: config.anthropicKey });
  return client;
}

function systemPrompt(lang, context) {
  return [
    'You are the health assistant inside Swasthya Setu, a public healthcare app used in villages and towns around Visakhapatnam, Andhra Pradesh.',
    'Many users have little formal education, weak internet and small phones. Write short, simple sentences a 12-year-old can follow, at most about 90 words.',
    `Always reply in ${LANGUAGE_NAMES[lang] || 'English'}, in that language's own script, even if the user mixes languages.`,
    'You help people understand symptoms and decide what to do next: rest at home, book a doctor, or get emergency help. You are not a doctor and do not diagnose; say "possibly" or "may be" rather than naming a disease as certain.',
    'If anything suggests an emergency (chest pain, trouble breathing, unconsciousness, stroke signs, heavy bleeding, poisoning, snake bite, seizures, pregnancy bleeding, suicidal thoughts), tell them to call 108 or open the Emergency button now, before anything else.',
    'You may suggest common over-the-counter care with standard adult doses (for example paracetamol), but never prescription medicines or dose changes; tell them to ask their doctor. Respect the allergies listed below.',
    'Ask at most two short follow-up questions when you need them. End with one clear next step.',
    'When they should see a doctor, tell them to tap the "Book fastest slot" button below your answer: it books the earliest free doctor near them.',
    context ? `Patient record (shared with consent): ${context}` : 'No patient record available.',
  ].join('\n');
}

function sanitize(messages) {
  const clean = (messages || [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  while (clean.length && clean[0].role !== 'user') clean.shift();
  return clean;
}

// Live caption translation for video consults. Returns null when translation
// isn't available, so callers show the original text instead.
export async function translate(text, from, to) {
  const ai = getClient();
  if (!ai || from === to || !text.trim()) return null;
  try {
    const response = await ai.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: `You translate spoken sentences between a doctor and a patient during a video consultation in India. Translate from ${LANGUAGE_NAMES[from] || from} to ${LANGUAGE_NAMES[to] || to}, in the target language's own script. Keep medicine names, doses and numbers exactly as spoken. Use simple, everyday words for the patient. Output only the translation, nothing else.`,
      messages: [{ role: 'user', content: text.slice(0, 1000) }],
    });
    if (response.stop_reason === 'refusal') return null;
    return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim() || null;
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.warn('Caption translation failed', err.status ?? '', err.message);
      return null;
    }
    throw err;
  }
}

/**
 * Without an AI key (or when the AI is down) the free rule-based chat answers,
 * so the assistant still asks questions and offers booking.
 * @returns {{ reply: string, severity: string|null, codes: string[], department: string|null, quickReplies: string[], book: boolean, source: 'triage'|'claude'|'fallback' }}
 */
export async function assistantReply({ messages, lang = 'en', context = '' }) {
  const history = sanitize(messages);
  const last = history.at(-1);
  if (!last || last.role !== 'user') throw Object.assign(new Error('The last message must be from the user'), { status: 400 });

  const local = chatReply(history, lang);
  const fallback = { ...local, source: 'fallback' };
  const { codes, severity } = triage(last.content);
  if (isUrgent(severity)) {
    return { ...local, reply: offlineAdvice(severity, lang), severity, codes, source: 'triage' };
  }

  const ai = getClient();
  if (!ai) return fallback;

  try {
    const response = await ai.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: systemPrompt(lang, context),
      messages: history,
    });
    if (response.stop_reason === 'refusal') return fallback;
    const reply = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!reply) return fallback;
    // Claude writes the answer; the booking button still uses the local department guess.
    const book = local.book || severity === 'medium';
    return { reply, severity, codes, department: book ? (local.department ?? 'general') : null, quickReplies: [], book, source: 'claude' };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) console.warn('Assistant rate limited');
    else if (err instanceof Anthropic.APIConnectionError) console.warn('Assistant: cannot reach the Claude API');
    else if (err instanceof Anthropic.APIError) console.error('Assistant API error', err.status, err.message);
    else throw err;
    return fallback;
  }
}
