import { createRequire } from 'module';
import { create } from 'ipfs-http-client';
import fs from 'fs';
import path from 'path';
import os from 'os';

const require = createRequire(import.meta.url);

export async function publishToIPFS(dirPath, options = {}) {
  const {
    gateway = '/ip4/127.0.0.1/tcp/5001',
    pinToServices = ['pinata', 'lighthouse'],
    onProgress = null
  } = options;

  try {
    const ipfs = create({ url: gateway });

    const dir = path.resolve(dirPath);
    if (!fs.existsSync(dir)) {
      throw new Error(`Directory not found: ${dir}`);
    }

    const files = [];
    function addFiles(currentPath, basePath) {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        const relativePath = path.relative(basePath, fullPath);

        if (entry.isDirectory()) {
          addFiles(fullPath, basePath);
        } else {
          files.push({
            path: relativePath,
            content: fs.readFileSync(fullPath)
          });
        }
      }
    }

    addFiles(dir, dir);

    if (onProgress) {
      onProgress({ status: 'preparing', fileCount: files.length });
    }

    let uploadedCount = 0;
    const results = [];

    for await (const result of ipfs.addAll(files, { wrapWithDirectory: true, pin: true })) {
      uploadedCount++;
      results.push(result);

      if (onProgress && result.path !== '') {
        onProgress({
          status: 'uploading',
          file: result.path,
          cid: result.cid.toString(),
          uploaded: uploadedCount,
          total: files.length
        });
      }
    }

    const rootCID = results[results.length - 1].cid.toString();

    if (onProgress) {
      onProgress({
        status: 'complete',
        rootCID,
        fileCount: files.length,
        results
      });
    }

    return {
      rootCID,
      files: results.filter(r => r.path !== '').map(r => ({
        path: r.path,
        cid: r.cid.toString(),
        size: r.size
      }))
    };
  } catch (error) {
    throw new Error(`IPFS publish failed: ${error.message}`);
  }
}

export async function publishModels() {
  const modelsDir = path.join(os.homedir(), '.gmgui', 'models');
  const whisperDir = path.join(modelsDir, 'onnx-community', 'whisper-base');
  const ttsDir = path.join(modelsDir, 'tts');

  console.log('Publishing models to IPFS...\n');

  const results = {};

  if (fs.existsSync(whisperDir)) {
    console.log('Publishing Whisper models...');
    try {
      const whisperResult = await publishToIPFS(whisperDir, {
        onProgress: (progress) => {
          if (progress.status === 'uploading') {
            console.log(`  ${progress.uploaded}/${progress.total}: ${progress.file}`);
          } else if (progress.status === 'complete') {
            console.log(`✓ Whisper CID: ${progress.rootCID}\n`);
          }
        }
      });
      results.whisper = whisperResult;
    } catch (error) {
      console.error(`✗ Whisper publish failed: ${error.message}`);
    }
  }

  if (fs.existsSync(ttsDir)) {
    console.log('Publishing TTS models...');
    try {
      const ttsResult = await publishToIPFS(ttsDir, {
        onProgress: (progress) => {
          if (progress.status === 'uploading') {
            console.log(`  ${progress.uploaded}/${progress.total}: ${progress.file}`);
          } else if (progress.status === 'complete') {
            console.log(`✓ TTS CID: ${progress.rootCID}\n`);
          }
        }
      });
      results.tts = ttsResult;
    } catch (error) {
      console.error(`✗ TTS publish failed: ${error.message}`);
    }
  }

  return results;
}
