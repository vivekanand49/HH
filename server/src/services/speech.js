// Speech-to-text for SOS voice messages with Bhashini, the Government of
// India's language platform (Telugu, Hindi, Marathi, English and more).
// Two calls, per the Bhashini API docs:
//   1. config call (userID + ulcaApiKey) → serviceId, compute URL, compute key
//   2. compute call with base64 audio → pipelineResponse[0].output[0].source
// Phones record WebM/Opus or MP4/AAC; Bhashini takes WAV/FLAC/MP3, so the
// audio is converted to 16 kHz mono WAV with ffmpeg first.
import { spawn } from 'node:child_process';
import { config } from '../config.js';

const CONFIG_URL = 'https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline';

export const speechEnabled = () => Boolean(config.bhashiniUserId && config.bhashiniApiKey && config.bhashiniPipelineId);

export async function toWav16k(buffer) {
  // FFMPEG_PATH: the system ffmpeg (the Docker image installs it); otherwise the bundled one.
  const ffmpegPath = process.env.FFMPEG_PATH || (await import('ffmpeg-static')).default;
  if (!ffmpegPath) throw new Error('ffmpeg is not available on this server');
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-t', '120', '-ac', '1', '-ar', '16000', '-f', 'wav', 'pipe:1']);
    const out = [];
    const err = [];
    const timer = setTimeout(() => ff.kill('SIGKILL'), 30000);
    ff.stdout.on('data', (d) => out.push(d));
    ff.stderr.on('data', (d) => err.push(d));
    ff.on('error', reject);
    ff.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg failed: ${Buffer.concat(err).toString().slice(0, 200)}`));
    });
    ff.stdin.on('error', () => {}); // ffmpeg may close early on bad input; 'close' reports it
    ff.stdin.end(buffer);
  });
}

// The compute URL and key change rarely; cache them per language for an hour.
const pipelines = new Map();

async function pipelineFor(lang, fetchImpl) {
  const hit = pipelines.get(lang);
  if (hit && hit.until > Date.now()) return hit;
  const res = await fetchImpl(CONFIG_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', userID: config.bhashiniUserId, ulcaApiKey: config.bhashiniApiKey },
    body: JSON.stringify({
      pipelineTasks: [{ taskType: 'asr', config: { language: { sourceLanguage: lang } } }],
      pipelineRequestConfig: { pipelineId: config.bhashiniPipelineId },
    }),
  });
  if (!res.ok) throw new Error(`Bhashini config call failed (${res.status})`);
  const data = await res.json();
  const entry = {
    serviceId: data.pipelineResponseConfig?.[0]?.config?.[0]?.serviceId,
    url: data.pipelineInferenceAPIEndPoint?.callbackUrl,
    keyName: data.pipelineInferenceAPIEndPoint?.inferenceApiKey?.name,
    keyValue: data.pipelineInferenceAPIEndPoint?.inferenceApiKey?.value,
    until: Date.now() + 60 * 60 * 1000,
  };
  if (!entry.serviceId || !entry.url || !entry.keyName) throw new Error('Bhashini config response missing fields');
  pipelines.set(lang, entry);
  return entry;
}

/** Returns the transcript text, or null if speech-to-text is not configured. */
export async function transcribe(audioBuffer, lang, { fetchImpl = fetch } = {}) {
  if (!speechEnabled()) return null;
  const wav = await toWav16k(audioBuffer);
  const p = await pipelineFor(lang, fetchImpl);
  const res = await fetchImpl(p.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [p.keyName]: p.keyValue },
    body: JSON.stringify({
      pipelineTasks: [{ taskType: 'asr', config: { language: { sourceLanguage: lang }, serviceId: p.serviceId, audioFormat: 'wav', samplingRate: 16000 } }],
      inputData: { audio: [{ audioContent: wav.toString('base64') }] },
    }),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) pipelines.delete(lang);
    throw new Error(`Bhashini compute call failed (${res.status})`);
  }
  const data = await res.json();
  return data.pipelineResponse?.[0]?.output?.[0]?.source?.trim() || null;
}
