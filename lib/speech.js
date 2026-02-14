import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import * as pocket from './pocket-sidecar.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.ogg', '.flac', '.m4a'];

function getVoiceDirs() {
  const dirs = [];
  const seen = new Set();
  const add = (d) => { const r = path.resolve(d); if (!seen.has(r)) { seen.add(r); dirs.push(r); } };
  const startupCwd = process.env.STARTUP_CWD || process.cwd();
  add(path.join(startupCwd, 'voices'));
  add(path.join(ROOT, 'voices'));
  add(path.join(os.homedir(), 'voices'));
  return dirs;
}

const MIN_WAV_SIZE = 1000;

const BASE_VOICES = [
  { id: 'default', name: 'Default', gender: 'male', accent: 'US' },
  { id: 'bdl', name: 'BDL', gender: 'male', accent: 'US' },
  { id: 'slt', name: 'SLT', gender: 'female', accent: 'US' },
  { id: 'clb', name: 'CLB', gender: 'female', accent: 'US' },
  { id: 'rms', name: 'RMS', gender: 'male', accent: 'US' },
  { id: 'awb', name: 'AWB', gender: 'male', accent: 'Scottish' },
  { id: 'jmk', name: 'JMK', gender: 'male', accent: 'Canadian' },
  { id: 'ksp', name: 'KSP', gender: 'male', accent: 'Indian' },
];

async function convertToWav(filePath) {
  const wavPath = filePath.replace(/\.[^.]+$/, '.wav');
  if (fs.existsSync(wavPath)) return wavPath;
  try {
    console.log('[VOICES] Converting to WAV:', filePath);
    const audio = await decodeAudioFile(filePath);
    const wav = encodeWav(audio, SAMPLE_RATE_STT);
    fs.writeFileSync(wavPath, wav);
    console.log('[VOICES] Converted:', path.basename(wavPath));
    return wavPath;
  } catch (err) {
    console.error('[VOICES] Conversion failed for', filePath + ':', err.message);
    return null;
  }
}

const pendingConversions = new Map();

function scanVoiceDir(dir) {
  const voices = [];
  try {
    if (!fs.existsSync(dir)) return voices;
    const listed = new Set();
    for (const file of fs.readdirSync(dir)) {
      const ext = path.extname(file).toLowerCase();
      if (!AUDIO_EXTENSIONS.includes(ext)) continue;
      const baseName = path.basename(file, ext);
      if (ext !== '.wav') {
        const wavExists = fs.existsSync(path.join(dir, baseName + '.wav'));
        if (wavExists) continue;
        const fullPath = path.join(dir, file);
        if (!pendingConversions.has(fullPath)) {
          pendingConversions.set(fullPath, convertToWav(fullPath).then(result => {
            pendingConversions.delete(fullPath);
            return result;
          }));
        }
      }
      if (listed.has(baseName)) continue;
      listed.add(baseName);
      const id = 'custom_' + baseName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const name = baseName.replace(/_/g, ' ');
      voices.push({ id, name, gender: 'custom', accent: 'custom', isCustom: true, sourceDir: dir });
    }
  } catch (err) {
    console.error('[VOICES] Error scanning', dir + ':', err.message);
  }
  return voices;
}

function loadCustomVoices() {
  const seen = new Set();
  const voices = [];
  for (const dir of getVoiceDirs()) {
    for (const v of scanVoiceDir(dir)) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      voices.push(v);
    }
  }
  return voices;
}

function getVoices() {
  return [...BASE_VOICES, ...loadCustomVoices()];
}

let transformersModule = null;
let sttPipeline = null;
let sttLoading = false;
let sttLoadError = null;
const SAMPLE_RATE_STT = 16000;

const TTS_CACHE_MAX_BYTES = 10 * 1024 * 1024;
let ttsCacheBytes = 0;
const ttsCache = new Map();
const ttsInflight = new Map();

async function loadTransformers() {
  if (transformersModule) return transformersModule;
  transformersModule = await import('@huggingface/transformers');
  return transformersModule;
}

function whisperModelPath() {
  try {
    const webtalkDir = path.dirname(require.resolve('webtalk'));
    const p = path.join(webtalkDir, 'models', 'onnx-community', 'whisper-base');
    if (fs.existsSync(p)) return p;
  } catch (_) {}
  return 'onnx-community/whisper-base';
}

function findCustomVoiceFile(voiceId) {
  const baseName = voiceId.replace(/^custom_/, '');
  for (const dir of getVoiceDirs()) {
    for (const ext of AUDIO_EXTENSIONS) {
      const candidate = path.join(dir, baseName + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

async function decodeAudioFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.wav') {
    const decoded = decodeWavToFloat32(buf);
    return resampleTo16k(decoded.audio, decoded.sampleRate);
  }
  const wavPath = filePath.replace(/\.[^.]+$/, '.wav');
  if (fs.existsSync(wavPath)) {
    const wavBuf = fs.readFileSync(wavPath);
    const decoded = decodeWavToFloat32(wavBuf);
    return resampleTo16k(decoded.audio, decoded.sampleRate);
  }
  const decode = (await import('audio-decode')).default;
  const audioBuffer = await decode(buf);
  const mono = audioBuffer.getChannelData(0);
  return resampleTo16k(mono, audioBuffer.sampleRate);
}

async function getSTT() {
  if (sttPipeline) return sttPipeline;
  if (sttLoadError) throw sttLoadError;
  if (sttLoading) {
    while (sttLoading) await new Promise(r => setTimeout(r, 100));
    if (sttLoadError) throw sttLoadError;
    if (!sttPipeline) throw new Error('STT pipeline failed to load');
    return sttPipeline;
  }
  sttLoading = true;
  try {
    const { pipeline, env } = await loadTransformers();
    const modelPath = whisperModelPath();
    const isLocal = !modelPath.includes('/') || fs.existsSync(modelPath);
    env.allowLocalModels = true;
    env.allowRemoteModels = !isLocal;
    if (isLocal) env.localModelPath = '';
    sttPipeline = await pipeline('automatic-speech-recognition', modelPath, {
      device: 'cpu',
      local_files_only: isLocal,
    });
    sttLoadError = null;
    return sttPipeline;
  } catch (err) {
    sttPipeline = null;
    sttLoadError = new Error('STT model load failed: ' + err.message);
    throw sttLoadError;
  } finally {
    sttLoading = false;
  }
}

function decodeWavToFloat32(buffer) {
  const view = new DataView(buffer.buffer || buffer);
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (riff !== 'RIFF') throw new Error('Not a WAV file');
  const numChannels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  let dataOffset = 44;
  for (let i = 36; i < view.byteLength - 8; i++) {
    if (view.getUint8(i) === 0x64 && view.getUint8(i+1) === 0x61 &&
        view.getUint8(i+2) === 0x74 && view.getUint8(i+3) === 0x61) {
      dataOffset = i + 8;
      break;
    }
  }
  const bytesPerSample = bitsPerSample / 8;
  const numSamples = Math.floor((view.byteLength - dataOffset) / (bytesPerSample * numChannels));
  const audio = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const offset = dataOffset + i * bytesPerSample * numChannels;
    if (bitsPerSample === 16) {
      audio[i] = view.getInt16(offset, true) / 32768;
    } else if (bitsPerSample === 32) {
      audio[i] = view.getFloat32(offset, true);
    } else {
      audio[i] = (view.getUint8(offset) - 128) / 128;
    }
  }
  return { audio, sampleRate };
}

function resampleTo16k(audio, fromRate) {
  if (fromRate === SAMPLE_RATE_STT) return audio;
  const ratio = fromRate / SAMPLE_RATE_STT;
  const newLen = Math.round(audio.length / ratio);
  const result = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, audio.length - 1);
    const frac = srcIdx - lo;
    result[i] = audio[lo] * (1 - frac) + audio[hi] * frac;
  }
  return result;
}

function encodeWav(float32Audio, sampleRate) {
  const numSamples = float32Audio.length;
  const bytesPerSample = 2;
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, float32Audio[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
  }
  return Buffer.from(buffer);
}

async function transcribe(audioBuffer) {
  const buf = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
  if (buf.length < MIN_WAV_SIZE) {
    throw new Error('Audio too short (' + buf.length + ' bytes)');
  }
  let audio;
  const isWav = buf.length > 4 && buf.toString('ascii', 0, 4) === 'RIFF';
  if (isWav) {
    let decoded;
    try {
      decoded = decodeWavToFloat32(buf);
    } catch (err) {
      throw new Error('WAV decode failed: ' + err.message);
    }
    if (!decoded.audio || decoded.audio.length === 0) {
      throw new Error('WAV contains no audio samples');
    }
    audio = resampleTo16k(decoded.audio, decoded.sampleRate);
  } else {
    const sampleCount = Math.floor(buf.byteLength / 4);
    if (sampleCount === 0) throw new Error('Audio buffer too small');
    const aligned = new ArrayBuffer(sampleCount * 4);
    new Uint8Array(aligned).set(buf.subarray(0, sampleCount * 4));
    audio = new Float32Array(aligned);
  }
  if (audio.length < 100) {
    throw new Error('Audio too short for transcription');
  }
  const stt = await getSTT();
  let result;
  try {
    result = await stt(audio);
  } catch (err) {
    throw new Error('Transcription engine error: ' + err.message);
  }
  if (!result || typeof result.text !== 'string') {
    return '';
  }
  return result.text;
}

function splitSentences(text) {
  const raw = text.match(/[^.!?]+[.!?]+[\s]?|[^.!?]+$/g);
  if (!raw) return [text];
  return raw.map(s => s.trim()).filter(s => s.length > 0);
}

function cachePut(key, buf) {
  if (ttsCache.has(key)) {
    ttsCacheBytes -= ttsCache.get(key).length;
    ttsCache.delete(key);
  }
  while (ttsCacheBytes + buf.length > TTS_CACHE_MAX_BYTES && ttsCache.size > 0) {
    const oldest = ttsCache.keys().next().value;
    ttsCacheBytes -= ttsCache.get(oldest).length;
    ttsCache.delete(oldest);
  }
  ttsCache.set(key, buf);
  ttsCacheBytes += buf.length;
}

function resolveVoicePath(voiceId) {
  if (!voiceId || voiceId === 'default') return null;
  return pocket.findVoiceFile(voiceId) || findCustomVoiceFile(voiceId);
}

async function synthesizeViaPocket(text, voiceId) {
  const pState = pocket.getState();
  if (!pState.healthy) throw new Error('pocket-tts not healthy');
  const voicePath = resolveVoicePath(voiceId);
  const wav = await pocket.synthesize(text, voicePath);
  if (wav && wav.length > 44) return wav;
  throw new Error('pocket-tts returned empty audio');
}

async function synthesize(text, voiceId) {
  const cacheKey = (voiceId || 'default') + ':' + text;
  const cached = ttsCache.get(cacheKey);
  if (cached) {
    ttsCache.delete(cacheKey);
    ttsCache.set(cacheKey, cached);
    return cached;
  }
  const inflight = ttsInflight.get(cacheKey);
  if (inflight) return inflight;
  const promise = (async () => {
    const wav = await synthesizeViaPocket(text, voiceId);
    cachePut(cacheKey, wav);
    return wav;
  })();
  ttsInflight.set(cacheKey, promise);
  try { return await promise; } finally { ttsInflight.delete(cacheKey); }
}

async function* synthesizeStream(text, voiceId) {
  const sentences = splitSentences(text);
  for (const sentence of sentences) {
    const cacheKey = (voiceId || 'default') + ':' + sentence;
    const cached = ttsCache.get(cacheKey);
    if (cached) {
      ttsCache.delete(cacheKey);
      ttsCache.set(cacheKey, cached);
      yield cached;
      continue;
    }
    const wav = await synthesizeViaPocket(sentence, voiceId);
    cachePut(cacheKey, wav);
    yield wav;
  }
}

function getStatus() {
  const pState = pocket.getState();
  return {
    sttReady: !!sttPipeline,
    ttsReady: pState.healthy,
    sttLoading,
    ttsLoading: false,
    sttError: sttLoadError ? sttLoadError.message : null,
    ttsError: pState.healthy ? null : (pState.lastError || 'pocket-tts not running'),
    pocketTts: pState,
  };
}

function preloadTTS() {
  const defaultVoice = findCustomVoiceFile('custom_cleetus') || '/config/voices/cleetus.wav';
  const voicePath = fs.existsSync(defaultVoice) ? defaultVoice : null;
  pocket.start(voicePath).then(ok => {
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
  const cached = ttsCache.get(key);
  if (cached) { ttsCache.delete(key); ttsCache.set(key, cached); }
  return cached || null;
}

export { transcribe, synthesize, synthesizeStream, getSTT, getStatus, getVoices, preloadTTS, ttsCacheKey, ttsCacheGet, splitSentences };
