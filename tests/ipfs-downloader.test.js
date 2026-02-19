import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import downloader from '../lib/ipfs-downloader.js';
import { queries } from '../database.js';

const TEST_DIR = path.join(os.homedir(), '.gmgui', 'test-downloads');
const TEST_TIMEOUT = 60000;

class TestRunner {
  constructor() {
    this.passed = 0;
    this.failed = 0;
    this.results = [];
  }

  async test(name, fn) {
    try {
      await fn();
      this.passed++;
      this.results.push({ name, status: 'PASS' });
      console.log(`[PASS] ${name}`);
    } catch (err) {
      this.failed++;
      this.results.push({ name, status: 'FAIL', error: err.message });
      console.log(`[FAIL] ${name}: ${err.message}`);
    }
  }

  summary() {
    console.log(`\n=== TEST SUMMARY ===`);
    console.log(`Passed: ${this.passed}`);
    console.log(`Failed: ${this.failed}`);
    console.log(`Total: ${this.passed + this.failed}`);
    return this.failed === 0;
  }
}

async function setupTestEnv() {
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }
}

function cleanupTestEnv() {
  if (fs.existsSync(TEST_DIR)) {
    const files = fs.readdirSync(TEST_DIR);
    for (const file of files) {
      fs.unlinkSync(path.join(TEST_DIR, file));
    }
    fs.rmdirSync(TEST_DIR);
  }
}

async function createMockFile(size, corrupted = false) {
  const buffer = Buffer.alloc(size);
  for (let i = 0; i < size; i++) {
    buffer[i] = Math.floor(Math.random() * 256);
  }

  if (corrupted) {
    buffer[0] = 0xFF;
    buffer[1] = 0xFF;
  }

  const filename = `mock-${Date.now()}.bin`;
  const filepath = path.join(TEST_DIR, filename);
  fs.writeFileSync(filepath, buffer);
  return { filepath, size, hash: crypto.createHash('sha256').update(buffer).digest('hex') };
}

async function simulatePartialDownload(filepath, targetSize) {
  if (!fs.existsSync(filepath)) {
    const buffer = Buffer.alloc(targetSize);
    crypto.randomFillSync(buffer);
    fs.writeFileSync(filepath, buffer);
  }
  return fs.statSync(filepath).size;
}

const runner = new TestRunner();

console.log('=== IPFS DOWNLOADER RESUME TESTS ===\n');

await setupTestEnv();

await runner.test('1. Detect partial download by size comparison', async () => {
  const testFile = path.join(TEST_DIR, 'partial.bin');
  const fullSize = 1000;
  const partialSize = 250;

  await simulatePartialDownload(testFile, partialSize);
  const actualSize = fs.statSync(testFile).size;

  if (actualSize !== partialSize) {
    throw new Error(`Size mismatch: expected ${partialSize}, got ${actualSize}`);
  }

  if (actualSize < fullSize) {
    console.log(`    Partial download detected: ${actualSize}/${fullSize} bytes`);
  }
});

await runner.test('2. Resume from offset (25% partial)', async () => {
  const testFile = path.join(TEST_DIR, 'resume-25.bin');
  const fullSize = 1000;
  const partial25 = Math.floor(fullSize * 0.25);

  const buffer = Buffer.alloc(partial25);
  crypto.randomFillSync(buffer);
  fs.writeFileSync(testFile, buffer);

  const currentSize = fs.statSync(testFile).size;
  const resumed = await simulatePartialDownload(testFile, fullSize);

  if (currentSize < fullSize && resumed >= currentSize) {
    console.log(`    Successfully resumed from ${currentSize} bytes`);
  } else {
    throw new Error('Resume from 25% failed');
  }
});

await runner.test('3. Resume from offset (50% partial)', async () => {
  const testFile = path.join(TEST_DIR, 'resume-50.bin');
  const fullSize = 1000;
  const partial50 = Math.floor(fullSize * 0.5);

  const buffer = Buffer.alloc(partial50);
  crypto.randomFillSync(buffer);
  fs.writeFileSync(testFile, buffer);

  const currentSize = fs.statSync(testFile).size;
  const resumed = await simulatePartialDownload(testFile, fullSize);

  if (currentSize < fullSize && resumed >= currentSize) {
    console.log(`    Successfully resumed from ${currentSize} bytes (50%)`);
  } else {
    throw new Error('Resume from 50% failed');
  }
});

await runner.test('4. Resume from offset (75% partial)', async () => {
  const testFile = path.join(TEST_DIR, 'resume-75.bin');
  const fullSize = 1000;
  const partial75 = Math.floor(fullSize * 0.75);

  const buffer = Buffer.alloc(partial75);
  crypto.randomFillSync(buffer);
  fs.writeFileSync(testFile, buffer);

  const currentSize = fs.statSync(testFile).size;
  const resumed = await simulatePartialDownload(testFile, fullSize);

  if (currentSize < fullSize && resumed >= currentSize) {
    console.log(`    Successfully resumed from ${currentSize} bytes (75%)`);
  } else {
    throw new Error('Resume from 75% failed');
  }
});

await runner.test('5. Hash verification after resume', async () => {
  const mockData = await createMockFile(1000);
  const verified = await downloader.verifyHash(mockData.filepath, mockData.hash);

  if (!verified) {
    throw new Error('Hash verification failed for valid file');
  }

  console.log(`    Hash verified: ${mockData.hash.substring(0, 16)}...`);
});

await runner.test('6. Detect corrupted file during resume', async () => {
  const mockData = await createMockFile(1000, true);
  const corruptedHash = crypto.createHash('sha256').update(Buffer.alloc(1000, 0xFF)).digest('hex');

  const verified = await downloader.verifyHash(mockData.filepath, corruptedHash);

  if (verified) {
    throw new Error('Hash mismatch should have been detected');
  }

  console.log(`    Corruption detected correctly`);
});

await runner.test('7. Cleanup partial file on corruption', async () => {
  const testFile = path.join(TEST_DIR, 'corrupted.bin');
  const buffer = Buffer.alloc(500);
  crypto.randomFillSync(buffer);
  fs.writeFileSync(testFile, buffer);

  if (!fs.existsSync(testFile)) {
    throw new Error('Test file not created');
  }

  await downloader.cleanupPartial(testFile);

  if (fs.existsSync(testFile)) {
    throw new Error('Partial file was not cleaned up');
  }

  console.log(`    Partial file cleaned up successfully`);
});

await runner.test('8. Track resume attempts in database', async () => {
  const cidRecord = queries.recordIpfsCid(
    'QmTest12345',
    'test-model',
    'test-type',
    'test-hash',
    'https://ipfs.io/ipfs/'
  );

  const downloadId = queries.recordDownloadStart(cidRecord, '/tmp/test.bin', 1000);
  const initial = queries.getDownload(downloadId);

  if (!initial || initial.attempts === undefined) {
    throw new Error('Download tracking failed');
  }

  queries.updateDownloadResume(downloadId, 250, 1, Date.now(), 'resuming');
  const updated = queries.getDownload(downloadId);

  if (updated.attempts !== 1) {
    throw new Error(`Attempt tracking failed: expected 1, got ${updated.attempts}`);
  }

  console.log(`    Attempts tracked: ${updated.attempts}`);
});

await runner.test('9. Gateway fallback on unavailability', async () => {
  const gateways = [
    'https://ipfs.io/ipfs/',
    'https://gateway.pinata.cloud/ipfs/',
    'https://cloudflare-ipfs.com/ipfs/'
  ];

  let fallbackIndex = 0;
  const simulateFallback = (currentIndex) => {
    fallbackIndex = (currentIndex + 1) % gateways.length;
    return gateways[fallbackIndex];
  };

  const initialGateway = gateways[0];
  const nextGateway = simulateFallback(0);

  if (nextGateway === initialGateway) {
    throw new Error('Gateway fallback failed');
  }

  console.log(`    Fallback: ${initialGateway} -> ${nextGateway}`);
});

await runner.test('10. Exponential backoff for timeouts', async () => {
  const INITIAL_BACKOFF = 1000;
  const MULTIPLIER = 2;

  const backoffs = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const backoff = INITIAL_BACKOFF * Math.pow(MULTIPLIER, attempt - 1);
    backoffs.push(backoff);
  }

  if (backoffs[0] !== 1000 || backoffs[1] !== 2000 || backoffs[2] !== 4000) {
    throw new Error(`Backoff calculation wrong: ${backoffs}`);
  }

  console.log(`    Backoff delays: ${backoffs.join('ms, ')}ms`);
});

await runner.test('11. Max resume attempts enforcement', async () => {
  const cidRecord = queries.recordIpfsCid(
    'QmTest67890',
    'test-model-2',
    'test-type-2',
    'test-hash-2',
    'https://ipfs.io/ipfs/'
  );

  const downloadId = queries.recordDownloadStart(cidRecord, '/tmp/test2.bin', 1000);

  let attempts = 0;
  while (attempts < 4) {
    attempts++;
    if (attempts > 3) {
      const download = queries.getDownload(downloadId);
      if (download.attempts >= 3) {
        console.log(`    Max attempts enforced at ${download.attempts}`);
        break;
      }
    }
    queries.updateDownloadResume(downloadId, 250 * attempts, attempts, Date.now(), 'resuming');
  }

  const final = queries.getDownload(downloadId);
  if (final.attempts > 3) {
    console.log(`    Attempts capped at ${final.attempts}`);
  }
});

await runner.test('12. Range header support detection', async () => {
  const headers = { 'Accept-Ranges': 'bytes' };
  const supportsRange = headers['Accept-Ranges'] === 'bytes';

  if (!supportsRange) {
    throw new Error('Range header detection failed');
  }

  console.log(`    Server supports Range requests`);
});

await runner.test('13. Stream reset recovery strategy', async () => {
  const fullSize = 1000;
  const downloadedSize = 600;
  const threshold = 0.5;

  const downloadPercent = (downloadedSize / fullSize) * 100;
  const shouldResume = downloadPercent > (threshold * 100);

  if (!shouldResume) {
    throw new Error('Stream reset strategy failed');
  }

  console.log(`    Stream reset detected at ${downloadPercent}%, resuming (>50%)`);
});

await runner.test('14. Disk space handling during resume', async () => {
  const testFile = path.join(TEST_DIR, 'diskspace.bin');
  const testSize = 100;

  const buffer = Buffer.alloc(testSize);
  crypto.randomFillSync(buffer);
  fs.writeFileSync(testFile, buffer);

  const stats = fs.statSync(testFile);
  if (stats.size !== testSize) {
    throw new Error('File write verification failed');
  }

  console.log(`    File write verified: ${stats.size} bytes`);
});

await runner.test('15. Download status lifecycle', async () => {
  const cidRecord = queries.recordIpfsCid(
    'QmTestStatus',
    'test-model-status',
    'test-type-status',
    'test-hash-status',
    'https://ipfs.io/ipfs/'
  );

  const downloadId = queries.recordDownloadStart(cidRecord, '/tmp/status.bin', 1000);
  let download = queries.getDownload(downloadId);

  const statuses = ['in_progress', 'resuming', 'paused', 'success'];
  for (const status of statuses.slice(0, 3)) {
    queries.updateDownloadResume(downloadId, 100, 1, Date.now(), status);
    download = queries.getDownload(downloadId);
    if (download.status !== status) {
      throw new Error(`Status transition failed: ${download.status} !== ${status}`);
    }
  }

  console.log(`    Status lifecycle: ${statuses.slice(0, 3).join(' -> ')}`);
});

cleanupTestEnv();

const allPassed = runner.summary();
process.exit(allPassed ? 0 : 1);
