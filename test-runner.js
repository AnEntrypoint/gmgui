import http from 'http';
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const results = {
  phase1: { status: 'PENDING', details: '' },
  phase2: { status: 'PENDING', details: '' },
  phase3: { status: 'PENDING', details: '' },
  phase4: { status: 'PENDING', details: '' },
  phase5: { status: 'PENDING', details: '' },
  phase6: { status: 'PENDING', details: '' },
  phase7: { status: 'PENDING', details: '' },
  phase8: { status: 'PENDING', details: '' },
  phase9: { status: 'PENDING', details: '' },
};

function log(phase, message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${phase}] ${message}`);
}

async function checkServerRunning() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3000', (res) => {
      resolve(res.statusCode === 200 || res.statusCode === 302);
      res.resume();
    });
    req.on('error', () => resolve(false));
  });
}

async function startServer() {
  return new Promise((resolve, reject) => {
    log('PHASE1', 'Starting server...');
    const proc = spawn('node', ['server.js'], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });

    let serverReady = false;
    let output = '';

    proc.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('Server running on port 3000') || output.includes('listening')) {
        if (!serverReady) {
          serverReady = true;
          log('PHASE1', 'Server appears to be ready, waiting for confirmation...');
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      console.error(`[SERVER] ${chunk.toString()}`);
    });

    setTimeout(async () => {
      const isRunning = await checkServerRunning();
      if (isRunning) {
        log('PHASE1', 'Server is responding to requests');
        resolve(proc);
      } else {
        reject(new Error('Server failed to start after timeout'));
      }
    }, 5000);
  });
}

async function cloneRepositories() {
  return new Promise((resolve, reject) => {
    log('PHASE3', 'Creating /tmp/test-repos directory');
    try {
      if (!fs.existsSync('/tmp/test-repos')) {
        fs.mkdirSync('/tmp/test-repos', { recursive: true });
      }

      log('PHASE3', 'Cloning lodash repository...');
      try {
        execSync('git clone https://github.com/lodash/lodash /tmp/test-repos/lodash 2>&1', {
          timeout: 60000,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        log('PHASE3', 'Lodash cloned successfully');
      } catch (e) {
        log('PHASE3', `Lodash clone output: ${e.toString().substring(0, 500)}`);
      }

      log('PHASE3', 'Cloning chalk repository...');
      try {
        execSync('git clone https://github.com/chalk/chalk /tmp/test-repos/chalk 2>&1', {
          timeout: 60000,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        log('PHASE3', 'Chalk cloned successfully');
      } catch (e) {
        log('PHASE3', `Chalk clone output: ${e.toString().substring(0, 500)}`);
      }

      const lodashExists = fs.existsSync('/tmp/test-repos/lodash/README.md');
      const chalkExists = fs.existsSync('/tmp/test-repos/chalk/README.md');

      if (lodashExists && chalkExists) {
        log('PHASE3', 'Both repositories cloned successfully');
        resolve({ lodashExists, chalkExists });
      } else {
        log('PHASE3', `Lodash: ${lodashExists}, Chalk: ${chalkExists}`);
        reject(new Error('Repository clone verification failed'));
      }
    } catch (e) {
      reject(e);
    }
  });
}

async function verifyServer() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3000', (res) => {
      log('PHASE1', `Server responded with status ${res.statusCode}`);
      resolve(res.statusCode === 200 || res.statusCode === 302);
      res.resume();
    });
    req.on('error', (err) => {
      log('PHASE1', `Server connection error: ${err.message}`);
      resolve(false);
    });
  });
}

async function executePhases() {
  try {
    // PHASE 1 & 3: Start server and clone repos (parallel, but we'll do sequentially for now)
    try {
      const running = await checkServerRunning();
      if (running) {
        log('PHASE1', 'Server is already running on port 3000');
        results.phase1.status = 'PASS';
        results.phase1.details = 'Server verified running on port 3000';
      } else {
        log('PHASE1', 'Server not running, attempting to start...');
        await startServer();
        const verified = await verifyServer();
        results.phase1.status = verified ? 'PASS' : 'FAIL';
        results.phase1.details = verified ? 'Server started and verified' : 'Server failed verification';
      }
    } catch (e) {
      results.phase1.status = 'FAIL';
      results.phase1.details = e.message;
      log('PHASE1', `ERROR: ${e.message}`);
    }

    // PHASE 3: Clone repositories
    try {
      const repos = await cloneRepositories();
      results.phase3.status = 'PASS';
      results.phase3.details = `Lodash: ${repos.lodashExists}, Chalk: ${repos.chalkExists}`;
    } catch (e) {
      results.phase3.status = 'FAIL';
      results.phase3.details = e.message;
      log('PHASE3', `ERROR: ${e.message}`);
    }

    // Write preliminary results
    fs.writeFileSync('/home/user/agentgui/TEST_RESULTS_PHASE1.json', JSON.stringify(results, null, 2));
    log('MAIN', 'Phase 1 and 3 complete. Preliminary results saved.');
    log('MAIN', 'Ready for browser-based testing (Phases 2, 4-8)');

    return results;
  } catch (e) {
    console.error('Test execution failed:', e);
    throw e;
  }
}

executePhases().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
