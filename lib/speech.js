import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

const serverSTT = require('webtalk/server-stt');
const serverTTS = require('webtalk/server-tts');

const EXTRA_VOICE_DIRS = [path.join(ROOT, 'voices')];
const TTS_PORT = 8787;

const TTS_CACHE_MAX = 10 * 1024 * 1024;
let cacheBytes = 0;
const cache = new Map();
const inflight = new Map();

function resolveVoice(voiceId) {
  if (!voiceId || voiceId === 'default') return null;
  return serverTTS.findVoiceFile(voiceId, EXTRA_VOICE_DIRS);
}

function cachePut(key, buf) {
  if (cache.has(key)) { cacheBytes -= cache.get(key).length; cache.delete(key); }
  while (cacheBytes + buf.length > TTS_CACHE_MAX && cache.size > 0) {
    const oldest = cache.keys().next().value;
    cacheBytes -= cache.get(oldest).length;
    cache.delete(oldest);
  }
  cache.set(key, buf);
  cacheBytes += buf.length;
}

function sendToPocket(text, voicePath) {
  return new Promise((resolve, reject) => {
    const boundary = '----PocketTTS' + Date.now();
    const parts = [];
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="text"\r\n\r\n${text}\r\n`);
    if (voicePath) {
      const data = fs.readFileSync(voicePath);
      const name = path.basename(voicePath);
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="voice_wav"; filename="${name}"\r\nContent-Type: audio/wav\r\n\r\n`);
      parts.push(data);
      parts.push('\r\n');
    }
    parts.push(`--${boundary}--\r\n`);
    const body = Buffer.concat(parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p)));
    const req = http.request({
      hostname: '127.0.0.1', port: TTS_PORT, path: '/tts', method: 'POST',
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
  return serverSTT.transcribe(audioBuffer);
}

function getSTT() {
  return serverSTT.getSTT();
}

async function synthesize(text, voiceId) {
  const status = serverTTS.getStatus();
  if (!status.ready) throw new Error('pocket-tts not healthy');
  const key = (voiceId || 'default') + ':' + text;
  const cached = cache.get(key);
  if (cached) { cache.delete(key); cache.set(key, cached); return cached; }
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = (async () => {
    const voicePath = resolveVoice(voiceId);
    const wav = await sendToPocket(text, voicePath);
    if (!wav || wav.length <= 44) throw new Error('pocket-tts returned empty audio');
    cachePut(key, wav);
    return wav;
  })();
  inflight.set(key, promise);
  try { return await promise; } finally { inflight.delete(key); }
}

async function* synthesizeStream(text, voiceId) {
  const status = serverTTS.getStatus();
  if (!status.ready) throw new Error('pocket-tts not healthy');
  const sentences = splitSentences(text);
  for (const sentence of sentences) {
    const key = (voiceId || 'default') + ':' + sentence;
    const cached = cache.get(key);
    if (cached) { cache.delete(key); cache.set(key, cached); yield cached; continue; }
    const voicePath = resolveVoice(voiceId);
    const wav = await sendToPocket(sentence, voicePath);
    if (wav && wav.length > 44) { cachePut(key, wav); yield wav; }
  }
}

function getVoices() {
  return serverTTS.getVoices(EXTRA_VOICE_DIRS);
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
  const defaultVoice = serverTTS.findVoiceFile('custom_cleetus', EXTRA_VOICE_DIRS) || '/config/voices/cleetus.wav';
  const voicePath = fs.existsSync(defaultVoice) ? defaultVoice : null;
  serverTTS.start(voicePath).then(ok => {
    if (ok) console.log('[TTS] pocket-tts sidecar started');
    else console.log('[TTS] pocket-tts failed to start');
  }).catch(err => {
    console.error('[TTS] pocket-tts start error:', err.message);
  });
}

function ttsCacheKey(text, voiceId) {
  return (voiceId || 'default') + ':' + text;
}

function ttsCacheGet(key) {
  const cached = cache.get(key);
  if (cached) { cache.delete(key); cache.set(key, cached); }
  return cached || null;
}

function splitSentences(text) {
  const raw = text.match(/[^.!?]+[.!?]+[\s]?|[^.!?]+$/g);
  if (!raw) return [text];
  return raw.map(s => s.trim()).filter(s => s.length > 0);
}

export { transcribe, synthesize, synthesizeStream, getSTT, getStatus, getVoices, preloadTTS, ttsCacheKey, ttsCacheGet, splitSentences };
