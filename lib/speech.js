import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

let serverSTT = null, serverTTS = null, edgeTTS = null;
try { serverSTT = require('webtalk/server-stt'); } catch(e) { console.warn('[STT] webtalk/server-stt unavailable:', e.message); }
try { serverTTS = require('webtalk/server-tts'); } catch(e) { console.warn('[TTS] webtalk/server-tts unavailable:', e.message); }
try { edgeTTS = require('edge-tts-universal'); } catch(e) { console.warn('[TTS] edge-tts-universal unavailable:', e.message); }

const EXTRA_VOICE_DIRS = [path.join(ROOT, 'voices')];

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

const EDGE_VOICE_MAP = {
  default: 'fr-FR-DeniseNeural', alba: 'fr-FR-DeniseNeural',
  marius: 'fr-FR-HenriNeural', javert: 'fr-FR-HenriNeural',
  jean: 'fr-FR-HenriNeural', fantine: 'fr-FR-DeniseNeural',
  cosette: 'fr-FR-DeniseNeural', eponine: 'fr-FR-DeniseNeural',
  azelma: 'fr-FR-DeniseNeural',
};

const PREDEFINED_IDS = new Set(POCKET_TTS_VOICES.filter(v => v.id !== 'default').map(v => v.id));
const POCKET_PORT = 8787;

let needsPatch = true;
try {
  if (serverTTS && typeof serverTTS.getVoices === 'function') {
    needsPatch = !serverTTS.getVoices(EXTRA_VOICE_DIRS).some(v => v.id === 'alba' && !v.isCustom);
  }
} catch(e) { needsPatch = true; }

function getSttOptions() {
  if (process.env.PORTABLE_DATA_DIR) {
    return { cacheDir: path.join(process.env.PORTABLE_DATA_DIR, 'models') };
  }
  return {};
}

async function edgeSynthesize(text, voiceId) {
  if (!edgeTTS) throw new Error('edge-tts-universal not available');
  const voice = EDGE_VOICE_MAP[voiceId] || EDGE_VOICE_MAP.default;
  const c = new edgeTTS.Communicate(text, voice);
  const chunks = [];
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('edge-tts timeout')), 30000));
  const collect = (async () => {
    for await (const chunk of c.stream()) {
      if (chunk.type === 'audio' && chunk.data) chunks.push(Buffer.from(chunk.data));
    }
  })();
  await Promise.race([collect, timeout]);
  if (!chunks.length) throw new Error('edge-tts returned no audio');
  return Buffer.concat(chunks);
}

function synthesizeDirect(text, voiceId) {
  const voicePath = serverTTS && typeof serverTTS.findVoiceFile === 'function'
    ? serverTTS.findVoiceFile(voiceId, EXTRA_VOICE_DIRS) : null;
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

function transcribe(audioBuffer) {
  if (!serverSTT) throw new Error('STT not available');
  return serverSTT.transcribe(audioBuffer, getSttOptions());
}

function getSTT() {
  if (!serverSTT) throw new Error('STT not available');
  return serverSTT.getSTT(getSttOptions());
}

async function synthesize(text, voiceId) {
  if (serverTTS) {
    try {
      if (needsPatch && voiceId && PREDEFINED_IDS.has(voiceId)) {
        return await synthesizeDirect(text, voiceId);
      }
      return await serverTTS.synthesize(text, voiceId, EXTRA_VOICE_DIRS);
    } catch(e) {
      console.warn('[TTS] webtalk synthesize failed, falling back to edge-tts:', e.message);
    }
  }
  return edgeSynthesize(text, voiceId);
}

async function* synthesizeStream(text, voiceId) {
  if (serverTTS) {
    try {
      if (needsPatch && voiceId && PREDEFINED_IDS.has(voiceId)) {
        yield await synthesizeDirect(text, voiceId);
        return;
      }
      for await (const chunk of serverTTS.synthesizeStream(text, voiceId, EXTRA_VOICE_DIRS)) {
        yield chunk;
      }
      return;
    } catch(e) {
      console.warn('[TTS] webtalk stream failed, falling back to edge-tts:', e.message);
    }
  }
  yield await edgeSynthesize(text, voiceId);
}

function getVoices() {
  try {
    const upstream = serverTTS && typeof serverTTS.getVoices === 'function'
      ? serverTTS.getVoices(EXTRA_VOICE_DIRS) : [];
    const custom = upstream.filter(v => v.isCustom);
    return [...POCKET_TTS_VOICES, ...custom];
  } catch(e) { return POCKET_TTS_VOICES; }
}

function getStatus() {
  const sttStatus = serverSTT ? serverSTT.getStatus() : { ready: false, loading: false, error: 'STT unavailable' };
  const ttsStatus = serverTTS ? serverTTS.getStatus() : { ready: false, lastError: 'TTS unavailable' };
  return {
    sttReady: sttStatus.ready,
    ttsReady: ttsStatus.ready || !!edgeTTS,
    sttLoading: sttStatus.loading,
    ttsLoading: false,
    sttError: sttStatus.error,
    ttsError: (ttsStatus.ready || edgeTTS) ? null : (ttsStatus.lastError || 'TTS not available'),
    pocketTts: ttsStatus,
    edgeTtsAvailable: !!edgeTTS,
  };
}

function preloadTTS() {
  if (!serverTTS || typeof serverTTS.start !== 'function') {
    if (edgeTTS) console.log('[TTS] Using edge-tts fallback');
    return;
  }
  if (typeof serverTTS.isInstalled === 'function' && !serverTTS.isInstalled()) {
    console.log('[TTS] pocket-tts not installed yet - will install on first use');
    return;
  }
  const portableDataDir = process.env.PORTABLE_DATA_DIR;
  const binaryPaths = portableDataDir ? [
    path.join(portableDataDir, 'pocket-venv', 'Scripts', 'pocket-tts.exe'),
    path.join(portableDataDir, 'pocket-venv', 'bin', 'pocket-tts'),
  ] : undefined;
  let voicePath = null;
  try {
    const defaultVoice = typeof serverTTS.findVoiceFile === 'function'
      ? (serverTTS.findVoiceFile('custom_cleetus', EXTRA_VOICE_DIRS) || '/config/voices/cleetus.wav')
      : '/config/voices/cleetus.wav';
    voicePath = fs.existsSync(defaultVoice) ? defaultVoice : null;
  } catch(e) {}
  serverTTS.start(voicePath, binaryPaths ? { binaryPaths } : {}).then(ok => {
    if (ok) console.log('[TTS] pocket-tts sidecar started');
    else console.log('[TTS] pocket-tts unavailable, edge-tts fallback active:', !!edgeTTS);
  }).catch(err => {
    console.error('[TTS] pocket-tts start error:', err.message);
  });
}

function ttsCacheKey(text, voiceId) {
  return serverTTS && typeof serverTTS.ttsCacheKey === 'function' ? serverTTS.ttsCacheKey(text, voiceId) : null;
}

function ttsCacheGet(key) {
  return serverTTS && typeof serverTTS.ttsCacheGet === 'function' ? serverTTS.ttsCacheGet(key) : null;
}

function splitSentences(text) {
  return serverTTS && typeof serverTTS.splitSentences === 'function' ? serverTTS.splitSentences(text) : [text];
}

export { transcribe, synthesize, synthesizeStream, getSTT, getStatus, getVoices, preloadTTS, ttsCacheKey, ttsCacheGet, splitSentences };
