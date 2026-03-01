import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const speech = require('webtalk/speech');
export const { transcribe, synthesize, synthesizeStream, getSTT, getStatus, getVoices, preloadTTS, ttsCacheKey, ttsCacheGet, splitSentences, resetSTTError, clearCorruptedSTTCache } = speech;
