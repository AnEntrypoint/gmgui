import https from 'https';
import fs from 'fs';
import path from 'path';
import os from 'os';

const testDir = path.join(os.tmpdir(), 'test-download-progress');
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
}

const GATEWAYS = [
  'https://ipfs.io',
  'https://gateway.pinata.cloud',
  'https://cloudflare-ipfs.com',
];

function downloadWithProgress(url, destination, onProgress = null) {
  let bytesDownloaded = 0;
  let totalBytes = 0;
  let lastProgressTime = Date.now();
  let lastProgressBytes = 0;
  const speeds = [];
  let retryCount = 0;
  let gatewayIndex = 0;

  const emitProgress = () => {
    const now = Date.now();
    const deltaTime = (now - lastProgressTime) / 1000;
    const deltaBytes = bytesDownloaded - lastProgressBytes;
    const speed = deltaTime > 0 ? Math.round(deltaBytes / deltaTime) : 0;

    if (speed > 0) {
      speeds.push(speed);
      if (speeds.length > 10) speeds.shift();
    }

    const avgSpeed = speeds.length > 0 ? Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length) : 0;
    const eta = avgSpeed > 0 && totalBytes > bytesDownloaded ? Math.round((totalBytes - bytesDownloaded) / avgSpeed) : 0;

    if (onProgress) {
      onProgress({
        bytesDownloaded,
        bytesRemaining: Math.max(0, totalBytes - bytesDownloaded),
        totalBytes,
        downloadSpeed: avgSpeed,
        eta,
        retryCount,
        currentGateway: url,
        status: bytesDownloaded >= totalBytes ? 'completed' : 'downloading',
        percentComplete: totalBytes > 0 ? Math.round((bytesDownloaded / totalBytes) * 100) : 0,
        timestamp: now
      });
    }

    lastProgressTime = now;
    lastProgressBytes = bytesDownloaded;
  };

  return new Promise((resolve, reject) => {
    const dir = path.dirname(destination);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const attemptDownload = (gateway) => {
      if (onProgress) {
        onProgress({
          bytesDownloaded: 0,
          bytesRemaining: 0,
          totalBytes: 0,
          downloadSpeed: 0,
          eta: 0,
          retryCount,
          currentGateway: gateway,
          status: 'connecting',
          percentComplete: 0,
          timestamp: Date.now()
        });
      }

      https.get(gateway, { timeout: 30000 }, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode)) {
          const location = res.headers.location;
          if (location) return attemptDownload(location);
        }

        if (res.statusCode !== 200) {
          res.resume();
          if (gatewayIndex < GATEWAYS.length - 1) {
            retryCount++;
            gatewayIndex++;
            return setTimeout(() => attemptDownload(GATEWAYS[gatewayIndex]), 1000 * Math.pow(2, Math.min(retryCount, 3)));
          }
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        totalBytes = parseInt(res.headers['content-length'], 10) || 0;
        bytesDownloaded = 0;
        lastProgressBytes = 0;
        lastProgressTime = Date.now();

        const file = fs.createWriteStream(destination);
        let lastEmit = Date.now();

        res.on('data', (chunk) => {
          bytesDownloaded += chunk.length;
          const now = Date.now();
          if (now - lastEmit >= 200) {
            emitProgress();
            lastEmit = now;
          }
        });

        res.on('end', () => {
          emitProgress();
          file.destroy();
          resolve({ destination, bytesDownloaded, success: true });
        });

        res.on('error', (err) => {
          file.destroy();
          fs.unlink(destination, () => {});
          if (gatewayIndex < GATEWAYS.length - 1) {
            retryCount++;
            gatewayIndex++;
            return setTimeout(() => attemptDownload(GATEWAYS[gatewayIndex]), 1000 * Math.pow(2, Math.min(retryCount, 3)));
          }
          reject(err);
        });

        file.on('error', (err) => {
          res.destroy();
          fs.unlink(destination, () => {});
          if (gatewayIndex < GATEWAYS.length - 1) {
            retryCount++;
            gatewayIndex++;
            return setTimeout(() => attemptDownload(GATEWAYS[gatewayIndex]), 1000 * Math.pow(2, Math.min(retryCount, 3)));
          }
          reject(err);
        });

        res.pipe(file);
      }).on('timeout', () => {
        if (gatewayIndex < GATEWAYS.length - 1) {
          retryCount++;
          gatewayIndex++;
          return setTimeout(() => attemptDownload(GATEWAYS[gatewayIndex]), 1000 * Math.pow(2, Math.min(retryCount, 3)));
        }
        reject(new Error('Download timeout'));
      }).on('error', (err) => {
        if (gatewayIndex < GATEWAYS.length - 1) {
          retryCount++;
          gatewayIndex++;
          return setTimeout(() => attemptDownload(GATEWAYS[gatewayIndex]), 1000 * Math.pow(2, Math.min(retryCount, 3)));
        }
        reject(err);
      });
    };

    attemptDownload(GATEWAYS[0]);
  });
}

let progressCount = 0;
let lastPrintTime = Date.now();
let minInterval = Infinity;
let maxInterval = 0;
const progressIntervals = [];

console.log('Starting download progress tracking test...\n');

downloadWithProgress(
  'https://www.w3.org/WAI/WCAG21/Techniques/pdf/pdf-files/table-example.pdf',
  path.join(testDir, 'test-file.pdf'),
  (progress) => {
    progressCount++;
    const now = Date.now();
    const interval = now - lastPrintTime;

    if (progressCount > 1) {
      progressIntervals.push(interval);
      minInterval = Math.min(minInterval, interval);
      maxInterval = Math.max(maxInterval, interval);
    }

    console.log(`[${progressCount}] Progress Update:
  Status: ${progress.status}
  Downloaded: ${(progress.bytesDownloaded / 1024).toFixed(1)}KB / ${(progress.totalBytes / 1024).toFixed(1)}KB
  Speed: ${(progress.downloadSpeed / 1024).toFixed(2)}MB/s
  ETA: ${progress.eta}s
  Complete: ${progress.percentComplete}%
  Retry Count: ${progress.retryCount}
  Gateway: ${progress.currentGateway}
  Interval: ${interval}ms\n`);

    lastPrintTime = now;
  }
).then((result) => {
  const avgInterval = progressIntervals.length > 0 ? progressIntervals.reduce((a, b) => a + b, 0) / progressIntervals.length : 0;
  console.log('\n=== Download Complete ===');
  console.log(`Result: ${JSON.stringify(result, null, 2)}`);
  console.log(`\nProgress Tracking Statistics:
  Total Updates: ${progressCount}
  Interval Range: ${minInterval}ms - ${maxInterval}ms
  Average Interval: ${avgInterval.toFixed(0)}ms
  Expected Interval: 200ms (should be 100-500ms range)`);

  if (avgInterval >= 100 && avgInterval <= 500) {
    console.log('  Status: PASS - Progress interval within acceptable range');
  } else {
    console.log('  Status: FAIL - Progress interval outside acceptable range');
  }

  if (fs.existsSync(path.join(testDir, 'test-file.pdf'))) {
    const stat = fs.statSync(path.join(testDir, 'test-file.pdf'));
    console.log(`\nDownloaded file size: ${(stat.size / 1024).toFixed(1)}KB`);
  }

  process.exit(0);
}).catch((err) => {
  console.error('Download failed:', err.message);
  process.exit(1);
});
