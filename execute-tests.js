#!/usr/bin/env node

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
const error = (msg) => console.error(`[ERROR] ${msg}`);

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function executePhase1() {
  log('=== PHASE 1: SERVER STARTUP ===');
  try {
    // Check if server is running
    try {
      const result = execSync('lsof -i :3000 2>/dev/null || true', { encoding: 'utf-8' });
      if (result.includes('node') || result.includes('LISTEN')) {
        log('Server already running on port 3000');
      } else {
        log('Starting server...');
        spawn('node', ['server.js', '--watch'], {
          cwd: __dirname,
          detached: true,
          stdio: 'ignore'
        }).unref();
        await sleep(3000);
      }
    } catch (e) {
      log('Starting server...');
      spawn('node', ['server.js', '--watch'], {
        cwd: __dirname,
        detached: true,
        stdio: 'ignore'
      }).unref();
      await sleep(3000);
    }

    // Verify server responds
    let retries = 0;
    while (retries < 10) {
      try {
        const response = execSync('curl -s -o /dev/null -w "%{http_code}" http://localhost:3000', { encoding: 'utf-8' });
        if (response === '200' || response === '302') {
          log(`Server responsive (HTTP ${response})`);
          return { success: true, timestamp: new Date().toISOString() };
        }
      } catch (e) {
        // Retry
      }
      retries++;
      await sleep(500);
    }

    error('Server did not respond after 5 seconds');
    return { success: false, error: 'Server not responding' };
  } catch (e) {
    error(`Phase 1 failed: ${e.message}`);
    return { success: false, error: e.message };
  }
}

async function executePhase3() {
  log('=== PHASE 3: TEST REPOSITORY SETUP ===');
  try {
    const repoDir = '/tmp/test-repos';

    if (!fs.existsSync(repoDir)) {
      fs.mkdirSync(repoDir, { recursive: true });
      log(`Created ${repoDir}`);
    }

    // Clone lodash
    log('Cloning lodash...');
    try {
      execSync('git clone --depth 1 https://github.com/lodash/lodash /tmp/test-repos/lodash 2>&1', { encoding: 'utf-8' });
    } catch (e) {
      if (!e.stdout?.includes('already exists')) {
        throw e;
      }
      log('Lodash already cloned');
    }

    // Verify lodash
    if (!fs.existsSync('/tmp/test-repos/lodash/README.md')) {
      throw new Error('Lodash clone verification failed');
    }
    log('Lodash clone verified');

    // Clone chalk
    log('Cloning chalk...');
    try {
      execSync('git clone --depth 1 https://github.com/chalk/chalk /tmp/test-repos/chalk 2>&1', { encoding: 'utf-8' });
    } catch (e) {
      if (!e.stdout?.includes('already exists')) {
        throw e;
      }
      log('Chalk already cloned');
    }

    // Verify chalk
    if (!fs.existsSync('/tmp/test-repos/chalk/readme.md')) {
      throw new Error('Chalk clone verification failed');
    }
    log('Chalk clone verified');

    return { success: true, lodash: '/tmp/test-repos/lodash', chalk: '/tmp/test-repos/chalk' };
  } catch (e) {
    error(`Phase 3 failed: ${e.message}`);
    return { success: false, error: e.message };
  }
}

async function main() {
  log('Starting End-to-End Test Execution');
  log('==================================');

  const results = {
    phase1: null,
    phase3: null,
    timestamp: new Date().toISOString()
  };

  // Wave 1: Execute PHASE 1 and PHASE 3 in parallel
  log('WAVE 1: Executing PHASE 1 and PHASE 3 in parallel...');

  const [phase1Result, phase3Result] = await Promise.all([
    executePhase1(),
    executePhase3()
  ]);

  results.phase1 = phase1Result;
  results.phase3 = phase3Result;

  log('\n=== WAVE 1 RESULTS ===');
  log(`PHASE 1 (Server): ${phase1Result.success ? 'PASS' : 'FAIL'}`);
  log(`PHASE 3 (Repos): ${phase3Result.success ? 'PASS' : 'FAIL'}`);

  if (!phase1Result.success || !phase3Result.success) {
    error('Wave 1 failed. Cannot continue.');
    process.exit(1);
  }

  log('\nWave 1 COMPLETE. Server is ready at http://localhost:3000');
  log('Test repositories cloned successfully.');
  log('\nNext: Run browser tests using plugin:browser:execute');

  // Save results
  fs.writeFileSync(
    path.join(__dirname, '.test-wave1-results.json'),
    JSON.stringify(results, null, 2)
  );
  log('\nResults saved to .test-wave1-results.json');
}

main().catch(e => {
  error(`Execution failed: ${e.message}`);
  process.exit(1);
});
