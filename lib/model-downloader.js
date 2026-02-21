import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { recordMetric } from './download-metrics.js';
import { verifyFileIntegrity } from './file-verification.js';

const require = createRequire(import.meta.url);

const GATEWAYS = [
  'https://cloudflare-ipfs.com/ipfs/',
  'https://dweb.link/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://ipfs.io/ipfs/'
];

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

export { getMetrics, getMetricsSummary, resetMetrics } from './download-metrics.js';
