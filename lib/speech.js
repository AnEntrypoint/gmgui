import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const speech = require('webtalk/speech');

const ttsMemCache = new Map();
const TTS_CACHE_MAX_BYTES = 10 * 1024 * 1024;
let ttsCacheBytes = 0;

function ttsCacheKey(text, voiceId) {
  return (voiceId || 'default') + ':' + text;
}

function ttsCacheGet(key) {
  return ttsMemCache.get(key) || null;
}

function ttsCacheSet(key, wav) {
  if (ttsMemCache.has(key)) return;
  const size = wav ? wav.length : 0;
  while (ttsCacheBytes + size > TTS_CACHE_MAX_BYTES && ttsMemCache.size > 0) {
    const oldest = ttsMemCache.keys().next().value;
    const old = ttsMemCache.get(oldest);
    ttsCacheBytes -= old ? old.length : 0;
    ttsMemCache.delete(oldest);
  }
  ttsMemCache.set(key, wav);
  ttsCacheBytes += size;
}

async function synthesizeWithCache(text, voiceId) {
  const key = ttsCacheKey(text, voiceId);
  const cached = ttsCacheGet(key);
  if (cached) return cached;
  const wav = await speech.synthesize(text, voiceId);
  ttsCacheSet(key, wav);
  return wav;
}

export const transcribe = speech.transcribe;
export const synthesize = synthesizeWithCache;
export const synthesizeStream = speech.synthesizeStream;
export const getSTT = speech.getSTT;
export const getStatus = speech.getStatus;
export const getVoices = speech.getVoices;
export const preloadTTS = speech.preloadTTS;
export { ttsCacheKey, ttsCacheGet, ttsCacheSet };
export const splitSentences = speech.splitSentences;
export const resetSTTError = speech.resetSTTError;
export const clearCorruptedSTTCache = speech.clearCorruptedSTTCache;
export const getSttOptions = speech.getSttOptions;
export const VOICE_DIRS = speech.VOICE_DIRS;
