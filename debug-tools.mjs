import * as toolManager from './lib/tool-manager.js';
import { queries } from './database.js';

async function debug() {
  console.log('=== TOOL UPDATE DEBUG ===\n');

  // Check all tools status
  console.log('1. Checking all tools async:');
  const tools = await toolManager.getAllToolsAsync();
  tools.forEach(t => {
    console.log(`   ${t.id}: installed=${t.installed}, version=${t.installedVersion}, published=${t.publishedVersion}, upToDate=${t.isUpToDate}, upgradeNeeded=${t.upgradeNeeded}`);
  });

  // Check specific tool
  const gm_cc = tools.find(t => t.id === 'gm-cc');
  if (!gm_cc) {
    console.log('\nClaude Code (gm-cc) not found in tools list');
    return;
  }

  console.log(`\n2. Claude Code Status:`);
  console.log(`   Installed: ${gm_cc.installed}`);
  console.log(`   Current Version: ${gm_cc.installedVersion}`);
  console.log(`   Published Version: ${gm_cc.publishedVersion}`);
  console.log(`   Up to Date: ${gm_cc.isUpToDate}`);
  console.log(`   Upgrade Needed: ${gm_cc.upgradeNeeded}`);

  // Check database status
  console.log(`\n3. Database status for gm-cc:`);
  const dbStatus = queries.getToolStatus('gm-cc');
  console.log(`   Database record:`, JSON.stringify(dbStatus, null, 2));

  // Simulate what happens on update
  console.log(`\n4. Simulating update flow:`);
  console.log(`   - Frontend calls POST /api/tools/gm-cc/update`);
  console.log(`   - Backend calls toolManager.update('gm-cc')`);
  console.log(`   - toolManager.update() calls spawnBunxProc to run 'bunx @anthropic-ai/claude-code'`);
  console.log(`   - After success, getInstalledVersion() checks for plugin.json`);
  console.log(`   - Version is returned to frontend via WebSocket 'tool_update_complete'`);
  console.log(`   - Frontend receives event and updates UI`);

  console.log(`\n5. Key paths checked by getInstalledVersion():`);
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  const paths = [
    `${homeDir}/.claude/plugins/@anthropic-ai/claude-code/plugin.json`,
    `${homeDir}/.config/opencode/agents/@anthropic-ai/claude-code/plugin.json`,
    `${homeDir}/.gemini/extensions/gm/plugin.json`,
    `${homeDir}/.config/kilo/agents/@anthropic-ai/claude-code/plugin.json`
  ];
  paths.forEach(p => console.log(`   ${p}`));
}

debug().catch(console.error);
