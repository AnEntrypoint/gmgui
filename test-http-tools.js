import http from 'http';

const BASE_URL = 'http://localhost:3000/gm';

async function httpGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    }).on('error', reject);
  });
}

async function httpPost(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const bodyStr = JSON.stringify(body);
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': bodyStr.length }
    };
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    }).on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function runTests() {
  console.log('=== HTTP API TESTS ===\n');

  try {
    console.log('TEST 1: GET /api/tools');
    const tools = await httpGet('/api/tools');
    console.log('Status:', tools.status);
    console.log('Tools:', tools.data?.tools?.length || 0);
    if (tools.data?.tools) {
      tools.data.tools.forEach(t => {
        console.log(`  ${t.id}: status=${t.status}, installed=${t.installed}, hasUpdate=${t.hasUpdate}`);
        console.log(`    versions: installed=${t.installedVersion}, published=${t.publishedVersion}`);
      });
    }
    console.log('');

    if (tools.data?.tools?.length > 0) {
      const firstTool = tools.data.tools[0];

      console.log(`TEST 2: GET /api/tools/${firstTool.id}/status`);
      const status = await httpGet(`/api/tools/${firstTool.id}/status`);
      console.log('Status code:', status.status);
      console.log('Status data:', JSON.stringify(status.data, null, 2));
      console.log('');

      if (firstTool.installed && firstTool.hasUpdate) {
        console.log(`TEST 3: POST /api/tools/${firstTool.id}/update (DRY RUN - not actually posting)`);
        console.log(`Would update: ${firstTool.id}`);
        console.log(`Current version: ${firstTool.installedVersion}`);
        console.log(`Available version: ${firstTool.publishedVersion}`);
        console.log('');

        console.log('FLOW WOULD BE:');
        console.log('  1. Frontend sends POST /api/tools/{id}/update');
        console.log('  2. Backend sets status to "updating" in DB');
        console.log('  3. Backend sends immediate 200 response');
        console.log('  4. Backend spawns bun x process async');
        console.log('  5. Backend broadcasts WebSocket "tool_update_progress" events');
        console.log('  6. When bun x completes:');
        console.log('     - Clears caches');
        console.log('     - Calls checkToolStatusAsync() for fresh status');
        console.log('     - Broadcasts "tool_update_complete" with new status');
        console.log('     - Updates DB with new version');
        console.log('  7. Frontend receives event and updates UI');
      }
    }

    console.log('\n=== TESTS COMPLETED ===');
    process.exit(0);
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}

runTests();
