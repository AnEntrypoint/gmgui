import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

// Load modules
let serverTTS = null;
let serverSTT = null;
let audioDecode = null;
let ttsUtils = null;

try { serverTTS = require('webtalk/server-tts'); } catch(e) { console.warn('[TTS] webtalk/server-tts unavailable:', e.message); }
try { serverSTT = require('webtalk/server-stt'); } catch(e) { console.warn('[STT] webtalk/server-stt unavailable:', e.message); }
try { audioDecode = require('audio-decode'); } catch(e) { console.warn('[TTS] audio-decode unavailable:', e.message); }
try { ttsUtils = require('webtalk/tts-utils'); } catch(e) {}

// Detect webtalk API type: old (server-tts.js with getVoices/synthesizeViaPocket)
// vs new ONNX (server-tts-onnx.js with encodeVoiceAudio)
const isOnnxApi = serverTTS && typeof serverTTS.encodeVoiceAudio === 'function';
const isPocketApi = serverTTS && typeof serverTTS.getVoices === 'function';

// Voice directories to scan
const VOICE_DIRS = [
  path.join(os.homedir(), 'voices'),
  path.join(ROOT, 'voices'),
  '/config/voices',
];

const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.ogg', '.flac', '.m4a'];

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

const SAMPLE_RATE = 24000;

// Embedding cache: voiceId -> {data, shape}
const voiceEmbeddingCache = new Map();

function getModelDir() {
  return path.join(os.homedir(), '.gmgui', 'models', 'tts');
}

function findVoiceFile(voiceId) {
  if (!voiceId || voiceId === 'default') return null;
  const baseName = voiceId.replace(/^custom_/, '');
  for (const dir of VOICE_DIRS) {
    for (const ext of AUDIO_EXTENSIONS) {
      const p = path.join(dir, baseName + ext);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function scanVoiceDir(dir) {
  const voices = [];
  try {
    if (!fs.existsSync(dir)) return voices;
    const seen = new Set();
    for (const file of fs.readdirSync(dir)) {
      const ext = path.extname(file).toLowerCase();
      if (!AUDIO_EXTENSIONS.includes(ext)) continue;
      const baseName = path.basename(file, ext);
      if (seen.has(baseName)) continue;
      seen.add(baseName);
      voices.push({
        id: 'custom_' + baseName.replace(/[^a-zA-Z0-9_-]/g, '_'),
        name: baseName.replace(/_/g, ' '),
        gender: 'custom', accent: 'custom', isCustom: true,
      });
    }
  } catch (_) {}
  return voices;
}

// Encode a voice WAV file to an ONNX voice embedding
async function getVoiceEmbedding(voiceId) {
  if (voiceEmbeddingCache.has(voiceId)) return voiceEmbeddingCache.get(voiceId);
  const voicePath = findVoiceFile(voiceId);
  if (!voicePath) return null;
  if (!audioDecode || !serverTTS || !isOnnxApi) return null;

  const modelDir = getModelDir();
  if (serverTTS.loadModels) await serverTTS.loadModels(modelDir);

  const raw = fs.readFileSync(voicePath);
  const decoded = await audioDecode.default(raw);
  let pcm = decoded.getChannelData(0);
  if (decoded.sampleRate !== SAMPLE_RATE) {
    pcm = ttsUtils ? ttsUtils.resample(pcm, decoded.sampleRate, SAMPLE_RATE)
      : (() => {
        const ratio = decoded.sampleRate / SAMPLE_RATE;
        const out = new Float32Array(Math.round(pcm.length / ratio));
        for (let i = 0; i < out.length; i++) out[i] = pcm[Math.floor(i * ratio)];
        return out;
      })();
  }

  const embedding = await serverTTS.encodeVoiceAudio(pcm);
  voiceEmbeddingCache.set(voiceId, embedding);
  return embedding;
}

// Convert Float32Array PCM to WAV buffer
function pcmToWav(samples, sampleRate = SAMPLE_RATE) {
  const numSamples = samples.length;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = numSamples * blockAlign;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(numChannels, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28); buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34); buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

function getSttOptions() {
  if (process.env.PORTABLE_EXE_DIR) {
    return { cacheDir: path.join(process.env.PORTABLE_EXE_DIR, 'models') };
  }
  if (process.env.PORTABLE_DATA_DIR) {
    return { cacheDir: path.join(process.env.PORTABLE_DATA_DIR, 'models') };
  }
  return {};
}

async function synthesize(text, voiceId) {
  if (isOnnxApi) {
    // Node.js ONNX TTS - no Python required
    const modelDir = getModelDir();
    const embedding = voiceId ? await getVoiceEmbedding(voiceId) : null;
    const pcm = await serverTTS.synthesize(text, embedding, modelDir);
    return pcmToWav(pcm);
  }

  if (isPocketApi) {
    // Old server-tts.js with pocket-tts sidecar
    return serverTTS.synthesize(text, voiceId, VOICE_DIRS);
  }

  throw new Error('No TTS backend available');
}

async function* synthesizeStream(text, voiceId) {
  if (isOnnxApi) {
    const modelDir = getModelDir();
    const embedding = voiceId ? await getVoiceEmbedding(voiceId) : null;
    const pcm = await serverTTS.synthesize(text, embedding, modelDir);
    yield pcmToWav(pcm);
    return;
  }

  if (isPocketApi) {
    for await (const chunk of serverTTS.synthesizeStream(text, voiceId, VOICE_DIRS)) {
      yield chunk;
    }
    return;
  }

  throw new Error('No TTS backend available');
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
  const seen = new Set();
  const custom = [];
  for (const dir of VOICE_DIRS) {
    for (const v of scanVoiceDir(dir)) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      custom.push(v);
    }
  }
  // Include built-in voices from old server-tts if available
  if (isPocketApi) {
    const upstream = serverTTS.getVoices(VOICE_DIRS).filter(v => v.isCustom);
    for (const v of upstream) {
      if (!seen.has(v.id)) { seen.add(v.id); custom.push(v); }
    }
  }
  return [...POCKET_TTS_VOICES, ...custom];
}

function getStatus() {
  const sttStatus = serverSTT ? serverSTT.getStatus() : { ready: false, loading: false, error: 'STT unavailable' };
  const ttsBackend = isOnnxApi ? 'onnx-node' : isPocketApi ? 'pocket-tts' : 'none';
  return {
    sttReady: sttStatus.ready,
    ttsReady: isOnnxApi || isPocketApi,
    sttLoading: sttStatus.loading,
    ttsLoading: false,
    sttError: sttStatus.error,
    ttsError: (!isOnnxApi && !isPocketApi) ? 'No TTS backend available' : null,
    ttsBackend,
  };
}

function preloadTTS() {
  if (isOnnxApi) {
    // Pre-load ONNX models in background
    const modelDir = getModelDir();
    if (serverTTS.loadModels) {
      serverTTS.loadModels(modelDir).catch(e => console.warn('[TTS] ONNX preload failed:', e.message));
    }
  } else if (isPocketApi && serverTTS.preload) {
    serverTTS.preload(null, {});
  }
}

function ttsCacheKey(text, voiceId) {
  return isPocketApi && serverTTS.ttsCacheKey ? serverTTS.ttsCacheKey(text, voiceId) : null;
}

function ttsCacheGet(key) {
  return isPocketApi && serverTTS.ttsCacheGet ? serverTTS.ttsCacheGet(key) : null;
}

function splitSentences(text) {
  if (isPocketApi && serverTTS.splitSentences) return serverTTS.splitSentences(text);
  return text.match(/[^.!?]+[.!?]*/g)?.map(s => s.trim()).filter(Boolean) || [text];
}

export { transcribe, synthesize, synthesizeStream, getSTT, getStatus, getVoices, preloadTTS, ttsCacheKey, ttsCacheGet, splitSentences };
