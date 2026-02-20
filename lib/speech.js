import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

let serverSTT = null;
try { serverSTT = require('webtalk/server-stt'); } catch(e) { console.warn('[STT] webtalk/server-stt unavailable:', e.message); }

const VOICE_DIRS = [path.join(ROOT, 'voices')];
const POCKET_PORT = 8787;

const POCKET_TTS_VOICES = [
  { id: 'default', name: 'Default', gender: 'female', accent: 'French' },
  { id: 'alba', name: 'Alba', gender: 'female', accent: 'French' },
  { id: 'marius', name: 'Marius', gender: 'male', accent: 'French' },
  { id: 'javert', name: 'Javert', gender: 'male', accent: 'French' },
  { id: 'jean', name: 'Jean', gender: 'male', accent: 'French' },
  { id: 'fantine', name: 'Fantine', gender: 'female', accent: 'French' },
  { id: 'cosette', name: 'Cosette', gender: 'female', accent: 'French' },
  { id: 'eponine', name: 'Eponine', gender: 'female', accent: 'French' },
  { id: 'azelma', name: 'Azelma', gender: 'female', accent: 'French' },
];

const PREDEFINED_IDS = new Set(POCKET_TTS_VOICES.filter(v => v.id !== 'default').map(v => v.id));

function getSttOptions() {
  if (process.env.PORTABLE_DATA_DIR) {
    return { cacheDir: path.join(process.env.PORTABLE_DATA_DIR, 'models') };
  }
  return {};
}

function findVoiceFile(voiceId) {
  for (const dir of VOICE_DIRS) {
    const p = path.join(dir, `custom_${voiceId}.wav`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function synthesize(text, voiceId) {
  const voicePath = voiceId ? findVoiceFile(voiceId) : null;
  const isPredefined = voiceId && PREDEFINED_IDS.has(voiceId);
  const boundary = '----PocketTTS' + Date.now();
  const parts = [];
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="text"\r\n\r\n${text}\r\n`);
  if (voicePath) {
    const data = fs.readFileSync(voicePath);
    const name = path.basename(voicePath);
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="voice_wav"; filename="${name}"\r\nContent-Type: audio/wav\r\n\r\n`);
    parts.push(data);
    parts.push('\r\n');
  } else if (isPredefined) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="voice_url"\r\n\r\n${voiceId}\r\n`);
  }
  parts.push(`--${boundary}--\r\n`);
  const body = Buffer.concat(parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p)));
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: POCKET_PORT, path: '/tts', method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
      timeout: 60000,
    }, res => {
      if (res.statusCode !== 200) {
        let e = '';
        res.on('data', d => e += d);
        res.on('end', () => reject(new Error(`pocket-tts HTTP ${res.statusCode}: ${e}`)));
        return;
      }
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('pocket-tts timeout')); });
    req.write(body);
    req.end();
  });
}

async function* synthesizeStream(text, voiceId) {
  yield await synthesize(text, voiceId);
}

function transcribe(audioBuffer) {
  if (!serverSTT) throw new Error('STT not available');
  return serverSTT.transcribe(audioBuffer, getSttOptions());
}

function getSTT() {
  if (!serverSTT) throw new Error('STT not available');
  return serverSTT.getSTT(getSttOptions());
}

function getVoices() {
  return POCKET_TTS_VOICES;
}

function getStatus() {
  const sttStatus = serverSTT ? serverSTT.getStatus() : { ready: false, loading: false, error: 'STT unavailable' };
  return {
    sttReady: sttStatus.ready,
    ttsReady: true,
    sttLoading: sttStatus.loading,
    ttsLoading: false,
    sttError: sttStatus.error,
    ttsError: null,
  };
}

function preloadTTS() {
  // pocket-tts is managed externally; nothing to preload
}

function ttsCacheKey(text, voiceId) { return null; }
function ttsCacheGet(key) { return null; }

function splitSentences(text) {
  return text.match(/[^.!?]+[.!?]*/g)?.map(s => s.trim()).filter(Boolean) || [text];
}

export { transcribe, synthesize, synthesizeStream, getSTT, getStatus, getVoices, preloadTTS, ttsCacheKey, ttsCacheGet, splitSentences };
