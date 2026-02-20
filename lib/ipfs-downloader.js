import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { queries } from '../database.js';

const GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://dweb.link/ipfs/'
];

const CONFIG = {
  MAX_RESUME_ATTEMPTS: 3,
  MAX_RETRY_ATTEMPTS: 3,
  TIMEOUT_MS: 30000,
  INITIAL_BACKOFF_MS: 1000,
  BACKOFF_MULTIPLIER: 2,
  get DOWNLOADS_DIR() { return path.join(process.env.PORTABLE_DATA_DIR || path.join(os.homedir(), '.gmgui'), 'downloads'); },
  RESUME_THRESHOLD: 0.5
};

class IPFSDownloader {
  constructor() {
    this.downloads = new Map();
    this.setupDir();
  }

  setupDir() {
    if (!fs.existsSync(CONFIG.DOWNLOADS_DIR)) {
      fs.mkdirSync(CONFIG.DOWNLOADS_DIR, { recursive: true });
    }
  }

  async download(cid, filename, options = {}) {
    const filepath = path.join(CONFIG.DOWNLOADS_DIR, filename);
    const { modelName = 'unknown', modelType = 'unknown', modelHash = null } = options;

    try {
      const cidId = queries.recordIpfsCid(cid, modelName, modelType, modelHash, GATEWAYS[0]);
      const downloadId = queries.recordDownloadStart(cidId, filepath, 0);

      await this.executeDownload(downloadId, cidId, filepath, options);
      return { success: true, downloadId, filepath, cid };
    } catch (error) {
      throw error;
    }
  }

  async executeDownload(downloadId, cidId, filepath, options = {}) {
    let gatewayIndex = 0;
    let resumeAttempts = 0;
    let retryAttempts = 0;

    while (true) {
      try {
        const gateway = GATEWAYS[gatewayIndex];
        const cidRecord = queries._db.prepare('SELECT * FROM ipfs_cids WHERE id = ?').get(cidId);
        if (!cidRecord) throw new Error('CID record not found');
        const url = `${gateway}${cidRecord.cid}`;

        const { size, hash } = await this.downloadFile(
          url,
          filepath,
          0,
          options
        );

        queries.completeDownload(downloadId, cidId);

        if (options.hashVerify && hash) {
          queries.updateDownloadHash(downloadId, hash);
        }

        return queries.getDownload(downloadId);
      } catch (error) {
        if (error.message.includes('Range')) {
          resumeAttempts++;
          if (resumeAttempts > CONFIG.MAX_RESUME_ATTEMPTS) {
            await this.cleanupPartial(filepath);
            gatewayIndex = (gatewayIndex + 1) % GATEWAYS.length;
            resumeAttempts = 0;
          }
        } else if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
          retryAttempts++;
          if (retryAttempts > CONFIG.MAX_RETRY_ATTEMPTS) {
            queries.recordDownloadError(downloadId, cidId, error.message);
            throw error;
          }
          const backoff = CONFIG.INITIAL_BACKOFF_MS * Math.pow(CONFIG.BACKOFF_MULTIPLIER, retryAttempts - 1);
          await this.sleep(backoff);
        } else if (error.message.includes('network') || error.message.includes('ECONNRESET')) {
          gatewayIndex = (gatewayIndex + 1) % GATEWAYS.length;
          retryAttempts = 0;
        } else {
          queries.recordDownloadError(downloadId, cidId, error.message);
          throw error;
        }
      }
    }
  }

  async downloadFile(url, filepath, resumeFrom = 0, options = {}) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      const headers = {};

      if (resumeFrom > 0) {
        headers['Range'] = `bytes=${resumeFrom}-`;
      }

      const req = protocol.get(url, { headers, timeout: CONFIG.TIMEOUT_MS }, (res) => {
        if (res.statusCode === 416) {
          reject(new Error('Range not supported - will delete partial and restart'));
          return;
        }

        if (![200, 206].includes(res.statusCode)) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const contentLength = parseInt(res.headers['content-length'], 10);
        const hash = crypto.createHash('sha256');
        let downloaded = resumeFrom;

        const mode = resumeFrom > 0 ? 'a' : 'w';
        const stream = fs.createWriteStream(filepath, { flags: mode });

        res.on('data', (chunk) => {
          hash.update(chunk);
          downloaded += chunk.length;
        });

        res.pipe(stream);

        stream.on('finish', () => {
          resolve({ size: downloaded, hash: hash.digest('hex') });
        });

        stream.on('error', (err) => {
          reject(new Error(`Write error: ${err.message}`));
        });
      });

      req.on('timeout', () => {
        req.abort();
        reject(new Error('timeout'));
      });

      req.on('error', (err) => {
        reject(new Error(`network: ${err.message}`));
      });
    });
  }

  async verifyHash(filepath, expectedHash) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filepath);

      stream.on('data', (chunk) => {
        hash.update(chunk);
      });

      stream.on('end', () => {
        resolve(hash.digest('hex') === expectedHash);
      });

      stream.on('error', (err) => {
        reject(err);
      });
    });
  }

  async resume(downloadId, options = {}) {
    const record = queries.getDownload(downloadId);

    if (!record) {
      throw new Error('Download not found');
    }

    if (record.status === 'success') {
      return record;
    }

    const attempts = (record.attempts || 0) + 1;
    if (attempts > CONFIG.MAX_RESUME_ATTEMPTS) {
      throw new Error('Max resume attempts exceeded');
    }

    try {
      const currentSize = fs.existsSync(record.downloadPath)
        ? fs.statSync(record.downloadPath).size
        : 0;

      if (currentSize === 0) {
        queries.recordDownloadStart(record.cidId, record.downloadPath, record.total_bytes);
        return this.resumeFromOffset(downloadId, record, 0, options);
      }

      queries.markDownloadResuming(downloadId);

      const downloadPercent = (currentSize / (record.total_bytes || currentSize)) * 100;

      if (downloadPercent > CONFIG.RESUME_THRESHOLD * 100) {
        return this.resumeFromOffset(downloadId, record, currentSize, options);
      } else {
        await this.cleanupPartial(record.downloadPath);
        return this.resumeFromOffset(downloadId, record, 0, options);
      }
    } catch (error) {
      const newAttempts = (record.attempts || 0) + 1;
      const newStatus = newAttempts >= CONFIG.MAX_RESUME_ATTEMPTS ? 'failed' : 'paused';
      queries.updateDownloadResume(downloadId, record.downloaded_bytes, newAttempts, Date.now(), newStatus);

      if (newStatus === 'failed') {
        throw error;
      }

      return queries.getDownload(downloadId);
    }
  }

  async resumeFromOffset(downloadId, record, offset, options) {
    try {
      const cidRecord = queries.getIpfsCidByModel(record.modelName, record.modelType);
      const gateway = GATEWAYS[0];
      const url = `${gateway}${cidRecord.cid}`;

      const { size, hash } = await this.downloadFile(
        url,
        record.downloadPath,
        offset,
        options
      );

      if (options.hashVerify && record.hash) {
        const verified = await this.verifyHash(record.downloadPath, record.hash);
        if (!verified) {
          await this.cleanupPartial(record.downloadPath);
          const newAttempts = (record.attempts || 0) + 1;
          queries.updateDownloadResume(downloadId, 0, newAttempts, Date.now(), 'pending');
          throw new Error('Hash verification failed - restarting');
        }
      }

      queries.completeDownload(downloadId, record.cidId);
      if (hash) {
        queries.updateDownloadHash(downloadId, hash);
      }

      return queries.getDownload(downloadId);
    } catch (error) {
      const newAttempts = (record.attempts || 0) + 1;
      const newStatus = newAttempts >= CONFIG.MAX_RESUME_ATTEMPTS ? 'failed' : 'paused';
      queries.updateDownloadResume(downloadId, offset, newAttempts, Date.now(), newStatus);

      if (newStatus === 'failed') {
        throw error;
      }

      return queries.getDownload(downloadId);
    }
  }

  async cleanupPartial(filepath) {
    if (fs.existsSync(filepath)) {
      try {
        fs.unlinkSync(filepath);
      } catch (err) {
        console.error(`Failed to cleanup partial file: ${filepath}`, err.message);
      }
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getDownloadStatus(downloadId) {
    return queries.getDownload(downloadId);
  }

  listDownloads(status = null) {
    if (status) {
      return queries.getDownloadsByStatus(status);
    }
    const allDownloads = queries.getDownloadsByStatus('in_progress');
    return allDownloads.concat(
      queries.getDownloadsByStatus('success'),
      queries.getDownloadsByStatus('paused'),
      queries.getDownloadsByStatus('failed')
    );
  }

  async cancelDownload(downloadId) {
    const record = queries.getDownload(downloadId);
    if (!record) return false;

    await this.cleanupPartial(record.downloadPath);
    queries.markDownloadPaused(downloadId, 'Cancelled by user');

    return true;
  }

  async downloadWithProgress(url, destination, onProgress = null) {
    const dir = path.dirname(destination);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let bytesDownloaded = 0;
    let totalBytes = 0;
    let lastProgressTime = Date.now();
    let lastProgressBytes = 0;
    const speeds = [];
    let gatewayIndex = 0;
    let retryCount = 0;

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

        const protocol = gateway.startsWith('https') ? https : http;
        protocol.get(gateway, { timeout: CONFIG.TIMEOUT_MS }, (res) => {
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
}

export default new IPFSDownloader();
