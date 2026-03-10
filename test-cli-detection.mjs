#!/usr/bin/env node
import { checkCliInstalled, getCliVersion } from './lib/tool-manager.js';
import { execSync } from 'child_process';

console.log('=== CLI Tool Detection Test ===\n');

const tools = [
  { pkg: '@anthropic-ai/claude-code', bin: 'claude' },
  { pkg: 'opencode-ai', bin: 'opencode' },
  { pkg: '@google/gemini-cli', bin: 'gemini' },
  { pkg: '@kilocode/cli', bin: 'kilo' },
  { pkg: '@openai/codex', bin: 'codex' }
];

tools.forEach(tool => {
  try {
    // Direct which check
    const which = process.platform === 'win32' ? 'where' : 'which';
    execSync(`${which} ${tool.bin}`, { stdio: 'pipe', timeout: 3000 });
    const version = execSync(`${tool.bin} --version`, { stdio: 'pipe', timeout: 2000, encoding: 'utf8' }).trim();
    const match = version.match(/(\d+\.\d+\.\d+)/);
    console.log(`✓ ${tool.pkg}`);
    console.log(`  Binary: ${tool.bin} (found)`);
    console.log(`  Version output: ${version.substring(0, 50)}`);
    console.log(`  Parsed version: ${match ? match[1] : 'NOT FOUND'}`);
  } catch (e) {
    console.log(`✗ ${tool.pkg}`);
    console.log(`  Binary: ${tool.bin} (not found in PATH)`);
  }
  console.log();
});

console.log('=== Testing Tool Manager Functions ===\n');

// Test with promises
console.log('Note: Tool manager functions require async context');
console.log('Use tool-manager directly in server to test full functionality');
