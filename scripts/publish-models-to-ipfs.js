#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import FormData from 'form-data';

const PINATA_API_KEY = process.env.PINATA_API_KEY || '';
const PINATA_SECRET_KEY = process.env.PINATA_SECRET_KEY || '';

async function uploadToPinata(dirPath, folderName) {
  if (!PINATA_API_KEY || !PINATA_SECRET_KEY) {
    throw new Error('PINATA_API_KEY and PINATA_SECRET_KEY environment variables required');
  }

  const form = new FormData();

  function addFilesRecursive(currentPath, basePath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      const relativePath = path.relative(basePath, fullPath);

      if (entry.isDirectory()) {
        addFilesRecursive(fullPath, basePath);
      } else {
        form.append('file', fs.createReadStream(fullPath), {
          filepath: `${folderName}/${relativePath}`
        });
      }
    }
  }

  addFilesRecursive(dirPath, dirPath);

  const metadata = JSON.stringify({
    name: folderName,
    keyvalues: {
      type: 'model',
      timestamp: new Date().toISOString()
    }
  });
  form.append('pinataMetadata', metadata);

  const options = JSON.stringify({
    wrapWithDirectory: false
  });
  form.append('pinataOptions', options);

  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'POST',
      hostname: 'api.pinata.cloud',
      path: '/pinning/pinFileToIPFS',
      headers: {
        ...form.getHeaders(),
        pinata_api_key: PINATA_API_KEY,
        pinata_secret_api_key: PINATA_SECRET_KEY
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`Pinata API error: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', reject);
    form.pipe(req);
  });
}

async function publishViaPinata() {
  const modelsDir = path.join(os.homedir(), '.gmgui', 'models');
  const whisperDir = path.join(modelsDir, 'onnx-community', 'whisper-base');
  const ttsDir = path.join(modelsDir, 'tts');

  console.log('Publishing models to IPFS via Pinata...\n');

  const results = {};

  if (fs.existsSync(whisperDir)) {
    console.log('Publishing Whisper models...');
    try {
      const result = await uploadToPinata(whisperDir, 'whisper-base');
      results.whisper = {
        cid: result.IpfsHash,
        size: result.PinSize,
        timestamp: result.Timestamp
      };
      console.log(`✓ Whisper CID: ${result.IpfsHash}`);
      console.log(`  Size: ${(result.PinSize / 1024 / 1024).toFixed(2)} MB\n`);
    } catch (error) {
      console.error(`✗ Whisper failed: ${error.message}\n`);
    }
  }

  if (fs.existsSync(ttsDir)) {
    console.log('Publishing TTS models...');
    try {
      const result = await uploadToPinata(ttsDir, 'tts-models');
      results.tts = {
        cid: result.IpfsHash,
        size: result.PinSize,
        timestamp: result.Timestamp
      };
      console.log(`✓ TTS CID: ${result.IpfsHash}`);
      console.log(`  Size: ${(result.PinSize / 1024 / 1024).toFixed(2)} MB\n`);
    } catch (error) {
      console.error(`✗ TTS failed: ${error.message}\n`);
    }
  }

  const manifestPath = path.join(modelsDir, '.manifests.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if (results.whisper) {
    manifest['whisper-base'].ipfsHash = results.whisper.cid;
    manifest['whisper-base'].publishedAt = new Date().toISOString();
  }
  if (results.tts) {
    manifest['tts-models'].ipfsHash = results.tts.cid;
    manifest['tts-models'].publishedAt = new Date().toISOString();
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`✓ Updated manifests at ${manifestPath}`);

  console.log('\n=== IPFS GATEWAYS ===');
  if (results.whisper) {
    console.log('\nWhisper models:');
    console.log(`  Cloudflare: https://cloudflare-ipfs.com/ipfs/${results.whisper.cid}`);
    console.log(`  dweb.link:  https://dweb.link/ipfs/${results.whisper.cid}`);
    console.log(`  Pinata:     https://gateway.pinata.cloud/ipfs/${results.whisper.cid}`);
  }
  if (results.tts) {
    console.log('\nTTS models:');
    console.log(`  Cloudflare: https://cloudflare-ipfs.com/ipfs/${results.tts.cid}`);
    console.log(`  dweb.link:  https://dweb.link/ipfs/${results.tts.cid}`);
    console.log(`  Pinata:     https://gateway.pinata.cloud/ipfs/${results.tts.cid}`);
  }

  return results;
}

console.log('AgentGUI Model Publishing Tool\n');
console.log('This script publishes Whisper and TTS models to IPFS via Pinata.');
console.log('Required: PINATA_API_KEY and PINATA_SECRET_KEY environment variables.\n');
console.log('Get free API keys at: https://www.pinata.cloud/\n');

if (!PINATA_API_KEY || !PINATA_SECRET_KEY) {
  console.error('ERROR: Missing Pinata credentials');
  console.error('Set environment variables:');
  console.error('  export PINATA_API_KEY=your_api_key');
  console.error('  export PINATA_SECRET_KEY=your_secret_key\n');
  process.exit(1);
}

publishViaPinata()
  .then(results => {
    console.log('\n✓ Publishing complete!');
    console.log(JSON.stringify(results, null, 2));
  })
  .catch(error => {
    console.error('\n✗ Publishing failed:', error.message);
    process.exit(1);
  });
