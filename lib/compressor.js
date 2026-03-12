/**
 * Compressor: tokenize text fields → msgpackr → optional gzip
 *
 * Transport:  event → msgpackr.pack() → gzip if >512B → binary WS frame
 * Storage:    text  → token array (Uint32) → msgpackr.pack() → BLOB
 */
import zlib from 'zlib';
import { pack, unpack } from 'msgpackr';
import { encode as encodeTokens, decode as decodeTokens } from 'gpt-tokenizer';

// Magic prefix stored at start of compressed BLOBs so we can detect them
const MAGIC = Buffer.from([0xC0, 0xDE]); // "CODE"
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

// ── Token helpers ─────────────────────────────────────────────────────────────

export function tokenize(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  try {
    return new Uint32Array(encodeTokens(text));
  } catch {
    return null;
  }
}

export function detokenize(tokens) {
  try {
    const arr = tokens instanceof Uint32Array ? Array.from(tokens) : tokens;
    return decodeTokens(arr);
  } catch {
    return null;
  }
}

// ── Storage compression (text → tokens → msgpack BLOB) ────────────────────────

/**
 * Compress a string for database storage.
 * Returns a Buffer starting with MAGIC prefix.
 */
export function compressForStorage(text) {
  if (typeof text !== 'string') return null;
  const tokens = tokenize(text);
  if (!tokens) return null;
  const packed = pack({ t: Array.from(tokens) });
  return Buffer.concat([MAGIC, packed]);
}

/**
 * Decompress a storage BLOB back to a string.
 * Returns null if not a compressed BLOB (caller should use raw value).
 */
export function decompressFromStorage(buf) {
  if (!Buffer.isBuffer(buf) && !(buf instanceof Uint8Array)) return null;
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length < MAGIC.length || b[0] !== MAGIC[0] || b[1] !== MAGIC[1]) return null;
  try {
    const { t } = unpack(b.slice(MAGIC.length));
    return detokenize(t);
  } catch {
    return null;
  }
}

// ── Transport compression (event → msgpack → gzip → binary frame) ─────────────

const GZ_THRESHOLD = 512; // bytes — compress if msgpack payload exceeds this

/**
 * Pack one event (or array of events) into a binary buffer for WebSocket transport.
 * Format: [ 0x01 ] + gzip(msgpack(data))  when compressed
 *         [ 0x00 ] + msgpack(data)         when not compressed
 */
export function packForTransport(data) {
  const packed = pack(data);
  if (packed.length > GZ_THRESHOLD) {
    try {
      const compressed = zlib.gzipSync(packed, { level: 6 });
      if (compressed.length < packed.length * 0.9) {
        const out = Buffer.allocUnsafe(1 + compressed.length);
        out[0] = 0x01; // flag: gzipped
        compressed.copy(out, 1);
        return out;
      }
    } catch (_) {}
  }
  const out = Buffer.allocUnsafe(1 + packed.length);
  out[0] = 0x00; // flag: plain msgpack
  packed.copy(out, 1);
  return out;
}

/**
 * Unpack a binary buffer received from WebSocket transport.
 */
export function unpackFromTransport(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length < 2) return null;
  const flag = b[0];
  const payload = b.slice(1);
  if (flag === 0x01) {
    return unpack(zlib.gunzipSync(payload));
  }
  return unpack(payload);
}

// ── Tokenize specific fields in an event object (for storage) ─────────────────

const TEXT_FIELDS = ['content', 'text', 'data', 'output', 'input', 'message', 'prompt', 'response'];

/**
 * Walk an event object and compress any large text fields in-place for storage.
 * Returns the (possibly mutated) object — safe to pass to JSON.stringify or pack().
 */
export function compressEventFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  for (const key of TEXT_FIELDS) {
    const val = obj[key];
    if (typeof val === 'string' && val.length > 64) {
      const buf = compressForStorage(val);
      if (buf) obj[key] = buf;
    }
  }
  return obj;
}
