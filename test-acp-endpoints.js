#!/usr/bin/env node

const http = require('http');

const BASE_URL = '/gm';
const PORT = 3000;

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: BASE_URL + path,
      method: method,
      headers: body ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(JSON.stringify(body))
      } : {}
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null, raw: data });
        } catch {
          resolve({ status: res.statusCode, data: null, raw: data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('Testing ACP Agents & Stateless Runs Endpoints\n');

  const tests = [
    {
      name: 'POST /api/agents/search - empty search',
      test: async () => {
        const res = await makeRequest('POST', '/api/agents/search', {});
        return res.status === 200 && res.data.agents !== undefined;
      }
    },
    {
      name: 'POST /api/agents/search - search by name',
      test: async () => {
        const res = await makeRequest('POST', '/api/agents/search', { name: 'Claude' });
        return res.status === 200 && Array.isArray(res.data.agents);
      }
    },
    {
      name: 'GET /api/agents/claude-code',
      test: async () => {
        const res = await makeRequest('GET', '/api/agents/claude-code');
        return res.status === 200 || res.status === 404;
      }
    },
    {
      name: 'GET /api/agents/claude-code/descriptor',
      test: async () => {
        const res = await makeRequest('GET', '/api/agents/claude-code/descriptor');
        return (res.status === 200 && res.data.metadata && res.data.specs) || res.status === 404;
      }
    },
    {
      name: 'POST /api/runs/search',
      test: async () => {
        const res = await makeRequest('POST', '/api/runs/search', {});
        return res.status === 200 && res.data.runs !== undefined;
      }
    },
    {
      name: 'POST /api/runs - missing agent_id',
      test: async () => {
        const res = await makeRequest('POST', '/api/runs', {});
        return res.status === 422;
      }
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const t of tests) {
    try {
      const success = await t.test();
      if (success) {
        console.log(`✓ ${t.name}`);
        passed++;
      } else {
        console.log(`✗ ${t.name}`);
        failed++;
      }
    } catch (err) {
      console.log(`✗ ${t.name} - ${err.message}`);
      failed++;
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

http.get(`http://localhost:${PORT}${BASE_URL}/`, (res) => {
  console.log('Server is running\n');
  runTests();
}).on('error', () => {
  console.log('Server is not running. Please start with: npm run dev');
  process.exit(1);
});
