import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

const serverSTT = require('webtalk/server-stt');
const serverTTS = require('webtalk/server-tts');

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

const PREDEFINED_IDS = new Set(POCKET_TTS_VOICES.filter(v => v.id !== 'default').map(v => v.id));
const POCKET_PORT = 8787;

function safeGetVoices(extraDirs) {
  if (typeof serverTTS.getVoices === 'function') {
    return serverTTS.getVoices(extraDirs || []);
  }
  return [];
}

const needsPatch = !safeGetVoices(EXTRA_VOICE_DIRS).some(v => v.id === 'alba' && !v.isCustom);

function synthesizeDirect(text, voiceId) {
  const voicePath = serverTTS.findVoiceFile(voiceId, EXTRA_VOICE_DIRS);
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

function getSttOptions() {
  if (process.env.PORTABLE_DATA_DIR) {
    return { cacheDir: path.join(process.env.PORTABLE_DATA_DIR, 'models') };
  }
  return {};
}

function transcribe(audioBuffer) {
  return serverSTT.transcribe(audioBuffer, getSttOptions());
}

function getSTT() {
  return serverSTT.getSTT(getSttOptions());
}

function synthesize(text, voiceId) {
  if (needsPatch && voiceId && PREDEFINED_IDS.has(voiceId)) {
    return synthesizeDirect(text, voiceId);
  }
  return serverTTS.synthesize(text, voiceId, EXTRA_VOICE_DIRS);
}

function synthesizeStream(text, voiceId) {
  if (needsPatch && voiceId && PREDEFINED_IDS.has(voiceId)) {
    return (async function* () {
      yield await synthesizeDirect(text, voiceId);
    })();
  }
  return serverTTS.synthesizeStream(text, voiceId, EXTRA_VOICE_DIRS);
}

function getVoices() {
  const upstream = safeGetVoices(EXTRA_VOICE_DIRS);
  const custom = upstream.filter(v => v.isCustom);
  return [...POCKET_TTS_VOICES, ...custom];
}

function getStatus() {
  const sttStatus = serverSTT.getStatus();
  const ttsStatus = serverTTS.getStatus();
  return {
    sttReady: sttStatus.ready,
    ttsReady: ttsStatus.ready,
    sttLoading: sttStatus.loading,
    ttsLoading: false,
    sttError: sttStatus.error,
    ttsError: ttsStatus.ready ? null : (ttsStatus.lastError || 'pocket-tts not running'),
    pocketTts: ttsStatus,
  };
}

function preloadTTS() {
  if (typeof serverTTS.findVoiceFile !== 'function' || typeof serverTTS.start !== 'function') {
    console.log('[TTS] pocket-tts functions not available');
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
  const defaultVoice = serverTTS.findVoiceFile('custom_cleetus', EXTRA_VOICE_DIRS) || '/config/voices/cleetus.wav';
  const voicePath = fs.existsSync(defaultVoice) ? defaultVoice : null;
  serverTTS.start(voicePath, binaryPaths ? { binaryPaths } : {}).then(ok => {
    if (ok) console.log('[TTS] pocket-tts sidecar started');
    else console.log('[TTS] pocket-tts not available - will use edge-tts fallback');
  }).catch(err => {
    console.error('[TTS] pocket-tts start error:', err.message);
  });
}

function ttsCacheKey(text, voiceId) {
  return typeof serverTTS.ttsCacheKey === 'function' ? serverTTS.ttsCacheKey(text, voiceId) : null;
}

function ttsCacheGet(key) {
  return typeof serverTTS.ttsCacheGet === 'function' ? serverTTS.ttsCacheGet(key) : null;
}

function splitSentences(text) {
  return typeof serverTTS.splitSentences === 'function' ? serverTTS.splitSentences(text) : [text];
}

export { transcribe, synthesize, synthesizeStream, getSTT, getStatus, getVoices, preloadTTS, ttsCacheKey, ttsCacheGet, splitSentences };
