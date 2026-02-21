import fs from 'fs';
import crypto from 'crypto';

export function verifyFileIntegrity(filepath, expectedHash, minBytes) {
  if (!fs.existsSync(filepath)) {
    return { valid: false, reason: 'file_not_found' };
  }

  const stats = fs.statSync(filepath);
  if (minBytes && stats.size < minBytes) {
    return { valid: false, reason: 'size_too_small', actual: stats.size, expected: minBytes };
  }

  if (expectedHash) {
    const hash = crypto.createHash('sha256');
    const data = fs.readFileSync(filepath);
    hash.update(data);
    const actualHash = hash.digest('hex');

    if (actualHash !== expectedHash) {
      return { valid: false, reason: 'hash_mismatch', actual: actualHash, expected: expectedHash };
    }
  }

  return { valid: true };
}
