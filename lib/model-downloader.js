import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { recordMetric } from './download-metrics.js';
import { verifyFileIntegrity } from './file-verification.js';

const require = createRequire(import.meta.url);

const GATEWAYS = [
  'https://cloudflare-huggingface.com/huggingface/',
  'https://dweb.link/huggingface/',
  'https://gateway.pinata.cloud/huggingface/',
  'https://huggingface.io/huggingface/'
];



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
    huggingfaceCid,
    huggingfaceUrl,
    destPath,
    manifest,
    minBytes,
    preferredLayer = } = options;

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

  const layers = preferredLayer === ? ['huggingface']
    : ['huggingface', ];

  for (const layer of layers) {
    try {
      if (layer === && huggingfaceCid) {
        return await downloadFromhuggingface(huggingfaceCid, destPath, manifest, onProgress);
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

export { getMetrics, getMetricsSummary, resetMetrics } from './download-metrics.js';
