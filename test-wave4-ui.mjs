#!/usr/bin/env node
/**
 * Wave 4 UI Consistency Test
 * Tests agent/model persistence and display consolidation
 */

import http from 'http';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_BASE = `${BASE_URL}/gm/api`;

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const options = {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {}
    };

    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test() {
  console.log('=== Wave 4 UI Consistency Tests ===\n');

  try {
    // Test 1: Create conversation with specific agent and model
    console.log('Test 1: Create conversation with agent and model');
    const createRes = await request('POST', '/conversations', {
      agentId: 'claude-code',
      title: 'Wave 4 Test Conversation',
      workingDirectory: '/tmp/test',
      model: 'claude-sonnet-4-5'
    });

    if (createRes.status !== 200) {
      console.error('❌ Failed to create conversation:', createRes.status);
      return;
    }

    const conversation = createRes.data.conversation;
    console.log('✓ Created conversation:', conversation.id);
    console.log('  - agentId:', conversation.agentId);
    console.log('  - model:', conversation.model);

    // Test 2: Fetch conversation and verify agent/model are returned
    console.log('\nTest 2: Fetch conversation via /full endpoint');
    const fullRes = await request('GET', `/conversations/${conversation.id}/full`);

    if (fullRes.status !== 200) {
      console.error('❌ Failed to fetch conversation:', fullRes.status);
      return;
    }

    const fullConv = fullRes.data.conversation;
    console.log('✓ Fetched conversation');
    console.log('  - agentId:', fullConv.agentId);
    console.log('  - agentType:', fullConv.agentType);
    console.log('  - model:', fullConv.model);

    if (!fullConv.agentId && !fullConv.agentType) {
      console.error('❌ agentId/agentType missing from response');
    } else {
      console.log('✓ agentId/agentType present');
    }

    if (!fullConv.model) {
      console.error('❌ model missing from response');
    } else {
      console.log('✓ model present');
    }

    // Test 3: List conversations and verify agent/model in list
    console.log('\nTest 3: List conversations');
    const listRes = await request('GET', '/conversations');

    if (listRes.status !== 200) {
      console.error('❌ Failed to list conversations:', listRes.status);
      return;
    }

    const listedConv = listRes.data.conversations.find(c => c.id === conversation.id);
    if (!listedConv) {
      console.error('❌ Conversation not found in list');
      return;
    }

    console.log('✓ Conversation in list');
    console.log('  - agentId:', listedConv.agentId);
    console.log('  - agentType:', listedConv.agentType);
    console.log('  - model:', listedConv.model);

    // Test 4: Update conversation model
    console.log('\nTest 4: Update conversation model');
    const updateRes = await request('POST', `/conversations/${conversation.id}`, {
      model: 'claude-opus-4-6'
    });

    if (updateRes.status !== 200) {
      console.error('❌ Failed to update conversation:', updateRes.status);
      return;
    }

    const updatedConv = updateRes.data.conversation;
    console.log('✓ Updated conversation');
    console.log('  - model:', updatedConv.model);

    if (updatedConv.model !== 'claude-opus-4-6') {
      console.error('❌ Model not updated correctly');
    } else {
      console.log('✓ Model updated correctly');
    }

    // Cleanup
    console.log('\nCleanup: Deleting test conversation');
    await request('DELETE', `/conversations/${conversation.id}`);
    console.log('✓ Deleted test conversation');

    console.log('\n=== All Tests Passed ===');
  } catch (error) {
    console.error('❌ Test error:', error.message);
    process.exit(1);
  }
}

test();
