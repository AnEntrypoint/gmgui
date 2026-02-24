// Integration test for run cancellation and control
import http from 'http';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { createACPQueries } from './acp-queries.js';

const dbPath = path.join(os.homedir(), '.gmgui', 'data.db');
const db = new Database(dbPath);
const prep = (sql) => db.prepare(sql);
const acpQueries = createACPQueries(db, prep);

const BASE_URL = 'http://localhost:3000/gm';
const testResults = {
  passed: [],
  failed: []
};

function testPass(name) {
  testResults.passed.push(name);
  console.log(`✓ ${name}`);
}

function testFail(name, error) {
  testResults.failed.push({ name, error });
  console.log(`✗ ${name}: ${error}`);
}

async function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const fullPath = `/gm${path}`;
    const options = {
      method,
      hostname: 'localhost',
      port: 3000,
      path: fullPath,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : null;
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, data: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('=== RUNNING INTEGRATION TESTS ===\n');

  try {
    // Test 1: Create a thread
    console.log('[Test 1] Creating thread...');
    const threadResp = await makeRequest('POST', '/api/threads', {});
    if ((threadResp.status === 200 || threadResp.status === 201) && threadResp.data.thread_id) {
      testPass('Thread creation');
    } else {
      testFail('Thread creation', `Status ${threadResp.status}`);
      return;
    }

    const threadId = threadResp.data.thread_id;

    // Test 2: Create a run (stateless, without thread)
    console.log('[Test 2] Creating stateless run...');
    const runResp = await makeRequest('POST', '/api/runs', {
      agent_id: 'claude-code',
      input: 'test input'
    });
    if (runResp.status === 200 && runResp.data.run_id) {
      testPass('Stateless run creation');
    } else {
      testFail('Stateless run creation', `Status ${runResp.status}`);
      return;
    }

    const runId = runResp.data.run_id;

    // Test 3: Verify run status is pending
    console.log('[Test 3] Verifying run status...');
    const run = acpQueries.getRun(runId);
    if (run && run.status === 'pending') {
      testPass('Run status is pending');
    } else {
      testFail('Run status is pending', `Status is ${run?.status}`);
    }

    // Test 4: Cancel the run using /api/runs/{run_id}/cancel
    console.log('[Test 4] Cancelling run via /api/runs/{run_id}/cancel...');
    const cancelResp = await makeRequest('POST', `/api/runs/${runId}/cancel`);
    if (cancelResp.status === 200 && cancelResp.data.status === 'cancelled') {
      testPass('Run cancellation via /api/runs');
    } else {
      testFail('Run cancellation via /api/runs', `Status ${cancelResp.status}, run status ${cancelResp.data?.status}`);
    }

    // Test 5: Verify run status is cancelled in database
    console.log('[Test 5] Verifying cancelled status in DB...');
    const cancelledRun = acpQueries.getRun(runId);
    if (cancelledRun && cancelledRun.status === 'cancelled') {
      testPass('Cancelled status persisted in database');
    } else {
      testFail('Cancelled status persisted in database', `Status is ${cancelledRun?.status}`);
    }

    // Test 6: Try to cancel again - should get 409 conflict
    console.log('[Test 6] Testing 409 conflict on re-cancel...');
    const recancel = await makeRequest('POST', `/api/runs/${runId}/cancel`);
    if (recancel.status === 409) {
      testPass('409 conflict on already-cancelled run');
    } else {
      testFail('409 conflict on already-cancelled run', `Got status ${recancel.status}`);
    }

    // Test 7: Test wait endpoint with already-completed run
    console.log('[Test 7] Testing wait endpoint with completed run...');
    const waitStart = Date.now();
    const waitResp = await makeRequest('GET', `/api/runs/${runId}/wait`);
    const waitDuration = Date.now() - waitStart;
    if (waitResp.status === 200 && waitDuration < 5000) {
      testPass('Wait endpoint returns immediately for completed run');
    } else {
      testFail('Wait endpoint returns immediately for completed run', `Took ${waitDuration}ms`);
    }

    // Test 8: Test cancellation of non-existent run
    console.log('[Test 8] Testing 404 on non-existent run...');
    const fakeRunId = randomUUID();
    const notFound = await makeRequest('POST', `/api/runs/${fakeRunId}/cancel`);
    if (notFound.status === 404) {
      testPass('404 on non-existent run');
    } else {
      testFail('404 on non-existent run', `Got status ${notFound.status}`);
    }

    // Cleanup
    console.log('\n[Cleanup] Deleting test thread...');
    try {
      acpQueries.deleteThread(threadId);
      console.log('Cleanup complete');
    } catch (e) {
      console.log('Cleanup warning:', e.message);
    }

  } catch (error) {
    console.error('Test suite error:', error);
    testFail('Test suite execution', error.message);
  }

  db.close();

  // Summary
  console.log('\n=== TEST SUMMARY ===');
  console.log(`Passed: ${testResults.passed.length}`);
  console.log(`Failed: ${testResults.failed.length}`);
  if (testResults.failed.length > 0) {
    console.log('\nFailed tests:');
    testResults.failed.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
  }

  return testResults.passed.length > 0 && testResults.failed.length === 0;
}

// Run the tests
runTests().then(success => {
  console.log(`\n${success ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}`);
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
