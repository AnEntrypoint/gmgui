import http from 'http';
import { queries } from './database.js';
import * as toolManager from './lib/tool-manager.js';

console.log('=== TOOL UPDATE SYSTEM TEST ===\n');

async function testToolAPI() {
  console.log('TEST 1: GET /api/tools endpoint');
  const tools = await toolManager.getAllToolsAsync();
  console.log('Tools found:', tools.length);
  tools.forEach(t => {
    console.log(`  - ${t.id}: installed=${t.installed}, isUpToDate=${t.isUpToDate}, upgradeNeeded=${t.upgradeNeeded}`);
    console.log(`    installed: ${t.installedVersion}, published: ${t.publishedVersion}`);
  });
  console.log('');
  return tools;
}

async function testVersionDetection() {
  console.log('TEST 2: Version detection for gm-cc');
  const status = await toolManager.checkToolStatusAsync('gm-cc');
  console.log('Status:', JSON.stringify(status, null, 2));
  console.log('');
  return status;
}

async function testCacheClearing() {
  console.log('TEST 3: Cache behavior');
  console.log('Before cache clear:');
  const status1 = await toolManager.checkToolStatusAsync('gm-cc');
  console.log('  gm-cc status:', status1.isUpToDate, status1.upgradeNeeded);

  console.log('\nClearing caches...');
  // This simulates what happens in install/update
  toolManager.getAllTools(); // Try to check status after cache clear
  const status2 = await toolManager.checkToolStatusAsync('gm-cc');
  console.log('After cache clear:');
  console.log('  gm-cc status:', status2.isUpToDate, status2.upgradeNeeded);
  console.log('');
}

async function testDatabase() {
  console.log('TEST 4: Database persistence');
  const existing = queries.getToolStatus('gm-cc');
  console.log('Existing tool status in DB:', existing);

  if (!existing) {
    queries.insertToolInstallation('gm-cc', { status: 'installed' });
    console.log('Inserted new tool status');
  }

  queries.updateToolStatus('gm-cc', { status: 'updating' });
  const updated = queries.getToolStatus('gm-cc');
  console.log('After update to "updating":', updated.status);

  queries.updateToolStatus('gm-cc', { status: 'installed', version: '1.0.0' });
  const final = queries.getToolStatus('gm-cc');
  console.log('After final update:', final.status, 'version:', final.version);
  console.log('');
}

async function testToolStatusAsync() {
  console.log('TEST 5: checkToolStatusAsync detailed');
  const tool = toolManager.getToolConfig('gm-cc');
  console.log('Tool config:', tool);

  const status = await toolManager.checkToolStatusAsync('gm-cc');
  console.log('Full status object keys:', Object.keys(status));
  console.log('Status data:');
  console.log(JSON.stringify(status, null, 2));
  console.log('');
}

async function runAllTests() {
  try {
    await testToolAPI();
    await testVersionDetection();
    await testCacheClearing();
    await testDatabase();
    await testToolStatusAsync();

    console.log('\n=== ALL TESTS COMPLETED ===');
    process.exit(0);
  } catch (err) {
    console.error('TEST ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

runAllTests();
