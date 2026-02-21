import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

const require = createRequire(import.meta.url);

const GATEWAYS = [
  'https://cloudflare-ipfs.com/ipfs/',
  'https://dweb.link/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://ipfs.io/ipfs/'
];

const METRICS_PATH = path.join(os.homedir(), '.gmgui', 'models', '.metrics.json');

function recordMetric(metric) {
  const metricsDir = path.dirname(METRICS_PATH);
  if (!fs.existsSync(metricsDir)) {
    fs.mkdirSync(metricsDir, { recursive: true });
  }

  let metrics = [];
  if (fs.existsSync(METRICS_PATH)) {
    try {
      metrics = JSON.parse(fs.readFileSync(METRICS_PATH, 'utf8'));
    } catch (e) {
      metrics = [];
    }
  }

  metrics.push({
    ...metric,
    timestamp: new Date().toISOString()
  });

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  metrics = metrics.filter(m => new Date(m.timestamp).getTime() > oneDayAgo);

  fs.writeFileSync(METRICS_PATH, JSON.stringify(metrics, null, 2));
}

function verifyFileIntegrity(filepath, expectedHash, minBytes) {
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

async function downloadFromIPFS(cid, destPath, manifest, onProgress) {
  const startTime = Date.now();

  for (let gatewayIndex = 0; gatewayIndex < GATEWAYS.length; gatewayIndex++) {
    const gateway = GATEWAYS[gatewayIndex];
    const gatewayName = new URL(gateway).hostname;

    for (let retry = 0; retry < 2; retry++) {
      try {
        if (onProgress) {
          onProgress({
            layer: 'ipfs',
            gateway: gatewayName,
            attempt: retry + 1,
            status: 'attempting'
          });
        }

        const { downloadWithProgress } = require('webtalk/ipfs-downloader');
        const url = `${gateway}${cid}`;

        await downloadWithProgress(url, destPath, (progress) => {
          if (onProgress) {
            onProgress({
              layer: 'ipfs',
              gateway: gatewayName,
              status: 'downloading',
              ...progress
            });
          }
        });

        const verification = verifyFileIntegrity(
          destPath,
          manifest?.sha256,
          manifest?.size ? manifest.size * 0.8 : null
        );

        if (!verification.valid) {
          if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
          throw new Error(`Verification failed: ${verification.reason}`);
        }

        recordMetric({
          modelType: 'model',
          layer: 'ipfs',
          gateway: gatewayName,
          status: 'success',
          latency_ms: Date.now() - startTime,
          bytes_downloaded: fs.statSync(destPath).size
        });

        return { success: true, source: 'ipfs', gateway: gatewayName };
      } catch (error) {
        recordMetric({
          modelType: 'model',
          layer: 'ipfs',
          gateway: gatewayName,
          status: 'error',
          error_type: error.name,
          error_message: error.message,
          latency_ms: Date.now() - startTime
        });

        if (retry < 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (retry + 1)));
        }
      }
    }
  }

  throw new Error('All IPFS gateways exhausted');
}

async function downloadFromHuggingFace(url, destPath, minBytes, onProgress) {
  const startTime = Date.now();

  try {
    if (onProgress) {
      onProgress({
        layer: 'huggingface',
        status: 'attempting'
      });
    }

    const { downloadFile } = require('webtalk/whisper-models');
    await downloadFile(url, destPath);

    const verification = verifyFileIntegrity(destPath, null, minBytes);
    if (!verification.valid) {
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      throw new Error(`Verification failed: ${verification.reason}`);
    }

    recordMetric({
      modelType: 'model',
      layer: 'huggingface',
      status: 'success',
      latency_ms: Date.now() - startTime,
      bytes_downloaded: fs.statSync(destPath).size
    });

    return { success: true, source: 'huggingface' };
  } catch (error) {
    recordMetric({
      modelType: 'model',
      layer: 'huggingface',
      status: 'error',
      error_type: error.name,
      error_message: error.message,
      latency_ms: Date.now() - startTime
    });

    throw error;
  }
}

export async function downloadWithFallback(options, onProgress) {
  const {
    ipfsCid,
    huggingfaceUrl,
    destPath,
    manifest,
    minBytes,
    preferredLayer = 'ipfs'
  } = options;

  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(destPath)) {
    const verification = verifyFileIntegrity(destPath, manifest?.sha256, minBytes);
    if (verification.valid) {
      recordMetric({
        modelType: 'model',
        layer: 'cache',
        status: 'hit'
      });
      return { success: true, source: 'cache' };
    } else {
      console.warn(`Cache invalid (${verification.reason}), re-downloading...`);
      const backupPath = `${destPath}.bak`;
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      fs.renameSync(destPath, backupPath);
    }
  }

  const layers = preferredLayer === 'ipfs'
    ? ['ipfs', 'huggingface']
    : ['huggingface', 'ipfs'];

  for (const layer of layers) {
    try {
      if (layer === 'ipfs' && ipfsCid) {
        return await downloadFromIPFS(ipfsCid, destPath, manifest, onProgress);
      } else if (layer === 'huggingface' && huggingfaceUrl) {
        return await downloadFromHuggingFace(huggingfaceUrl, destPath, minBytes, onProgress);
      }
    } catch (error) {
      console.warn(`${layer} layer failed:`, error.message);
      continue;
    }
  }

  recordMetric({
    modelType: 'model',
    status: 'all_layers_exhausted'
  });

  throw new Error('All download layers exhausted');
}

export function getMetrics() {
  if (!fs.existsSync(METRICS_PATH)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(METRICS_PATH, 'utf8'));
}

export function getMetricsSummary() {
  const metrics = getMetrics();

  const summary = {
    total: metrics.length,
    cache_hits: metrics.filter(m => m.layer === 'cache' && m.status === 'hit').length,
    ipfs: {
      success: metrics.filter(m => m.layer === 'ipfs' && m.status === 'success').length,
      error: metrics.filter(m => m.layer === 'ipfs' && m.status === 'error').length,
      avg_latency: 0
    },
    huggingface: {
      success: metrics.filter(m => m.layer === 'huggingface' && m.status === 'success').length,
      error: metrics.filter(m => m.layer === 'huggingface' && m.status === 'error').length,
      avg_latency: 0
    }
  };

  const ipfsSuccess = metrics.filter(m => m.layer === 'ipfs' && m.status === 'success');
  if (ipfsSuccess.length > 0) {
    summary.ipfs.avg_latency = Math.round(
      ipfsSuccess.reduce((sum, m) => sum + m.latency_ms, 0) / ipfsSuccess.length
    );
  }

  const hfSuccess = metrics.filter(m => m.layer === 'huggingface' && m.status === 'success');
  if (hfSuccess.length > 0) {
    summary.huggingface.avg_latency = Math.round(
      hfSuccess.reduce((sum, m) => sum + m.latency_ms, 0) / hfSuccess.length
    );
  }

  return summary;
}

export function resetMetrics() {
  if (fs.existsSync(METRICS_PATH)) {
    fs.unlinkSync(METRICS_PATH);
  }
}
