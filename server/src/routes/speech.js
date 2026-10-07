// Speech for the assistant and voice booking when the phone's browser can't do
// it itself (no Telugu/Marathi voice, or no speech recognition): Bhashini on the server.
import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { parse } from '../validate.js';
import { requireAuth } from '../middleware/auth.js';
import { checkUpload, VOICE_TYPES } from '../services/storage.js';
import { espeak, espeakAvailable, speechEnabled, synthesize, transcribe, ttsEnabled } from '../services/speech.js';

const r = Router();
const lang = z.enum(['en', 'te', 'hi', 'mr']);

r.get('/config', (_req, res) => res.json({ tts: ttsEnabled(), stt: speechEnabled() }));

r.use(requireAuth, rateLimit({ windowMs: 60 * 1000, limit: 30, message: { error: 'Too many voice requests. Please wait a minute.' } }));

// Bhashini's natural voice when it's set up; otherwise (or if it fails) eSpeak's robot voice.
r.post('/tts', async (req, res) => {
  const body = parse(z.object({ text: z.string().trim().min(1).max(600), lang }), req.body);
  if (!ttsEnabled()) return res.status(501).json({ error: 'Voice is not set up on this server.' });
  let wav = null;
  if (speechEnabled()) {
    wav = await synthesize(body.text, body.lang).catch((err) => {
      console.warn('Bhashini text-to-speech failed:', err.message);
      return null;
    });
  }
  if (!wav && espeakAvailable()) {
    wav = await espeak(body.text, body.lang).catch((err) => {
      console.warn('eSpeak failed:', err.message);
      return null;
    });
  }
  if (!wav) return res.status(502).json({ error: 'Could not make the voice. Please read the answer.' });
  res.set('content-type', 'audio/wav').set('cache-control', 'private, max-age=3600').send(wav);
});

r.post('/stt', express.raw({ type: Object.keys(VOICE_TYPES), limit: '3mb' }), async (req, res) => {
  const q = parse(z.object({ lang }), req.query);
  if (!speechEnabled()) return res.status(501).json({ error: 'Voice is not set up on this server.' });
  const check = checkUpload(req.body, req.get('content-type'), VOICE_TYPES);
  if (check.error) return res.status(400).json({ error: check.error });
  try {
    res.json({ text: (await transcribe(req.body, q.lang)) ?? '' });
  } catch (err) {
    console.warn('Speech-to-text failed:', err.message);
    res.status(502).json({ error: 'Could not understand the recording. Please try again or type.' });
  }
});

export default r;
