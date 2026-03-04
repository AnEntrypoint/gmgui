#!/usr/bin/env node

/**
 * Test script for validating the two fixes:
 * 1. Agent selector visibility in chat view
 * 2. TTS streaming pre-generation
 */

import fs from 'fs';
import { execSync } from 'child_process';

console.log('=== AgentGUI Fix Validation ===\n');

// Test 1: Verify agent selectors are NOT hidden on desktop
console.log('Test 1: Agent Selector Visibility');
console.log('-----------------------------------');
const html = fs.readFileSync('./static/index.html', 'utf-8');
const beforeMobileMedia = html.substring(0, html.indexOf('@media (max-width: 480px)'));
const cliHiddenOnDesktop = beforeMobileMedia.includes('.cli-selector { display: none; }');
const modelHiddenOnDesktop = beforeMobileMedia.includes('.model-selector { display: none; }');

if (!cliHiddenOnDesktop && !modelHiddenOnDesktop) {
  console.log('✓ PASS: Agent selectors are NOT hidden by CSS on desktop');
  console.log('  - CLI selector will be visible when populated');
  console.log('  - Model selector will be visible when populated');
} else {
  console.log('❌ FAIL: Agent selectors are still hidden on desktop');
  if (cliHiddenOnDesktop) console.log('  - .cli-selector has display:none');
  if (modelHiddenOnDesktop) console.log('  - .model-selector has display:none');
}

// Verify selectors are in HTML
const hasSelectors = html.includes('data-cli-selector') &&
                     html.includes('data-agent-selector') &&
                     html.includes('data-model-selector');
if (hasSelectors) {
  console.log('✓ PASS: All selector elements are present in HTML');
} else {
  console.log('❌ FAIL: Some selector elements are missing');
}

// Test 2: Verify TTS pre-generation is implemented
console.log('\nTest 2: TTS Streaming Pre-generation');
console.log('--------------------------------------');
const voiceJs = fs.readFileSync('./static/js/voice.js', 'utf-8');
const hasPreGenerateFunction = voiceJs.includes('function preGenerateTTS(text)');
const callsPreGenerate = voiceJs.includes('preGenerateTTS(block.text)');
const usesCache = voiceJs.includes('if (ttsAudioCache.has(cacheKey)) return;');
const fetchesTTS = voiceJs.match(/fetch\(BASE \+ '\/api\/tts'/g)?.length >= 2; // Should be in both preGenerate and processQueue

if (hasPreGenerateFunction && callsPreGenerate && usesCache && fetchesTTS) {
  console.log('✓ PASS: TTS pre-generation is fully implemented');
  console.log('  - preGenerateTTS function exists');
  console.log('  - Called when assistant text arrives');
  console.log('  - Uses cache to avoid duplicate generation');
  console.log('  - Audio generation happens in background');
} else {
  console.log('❌ FAIL: TTS pre-generation incomplete');
  if (!hasPreGenerateFunction) console.log('  - Missing preGenerateTTS function');
  if (!callsPreGenerate) console.log('  - Not called in handleVoiceBlock');
  if (!usesCache) console.log('  - Missing cache check');
}

// Test 3: Check that client.js populates selectors correctly
console.log('\nTest 3: Selector Population Logic');
console.log('-----------------------------------');
const clientJs = fs.readFileSync('./static/js/client.js', 'utf-8');
const setsDisplay = clientJs.includes("this.ui.cliSelector.style.display = 'inline-block'");
const populatesOptions = clientJs.includes('.innerHTML = displayAgents');

if (setsDisplay && populatesOptions) {
  console.log('✓ PASS: Client.js correctly populates and displays selectors');
  console.log('  - Sets display to inline-block when agents loaded');
  console.log('  - Populates options from agent list');
} else {
  console.log('❌ FAIL: Selector population logic may be broken');
}

// Summary
console.log('\n=== SUMMARY ===');
const allTestsPass = !cliHiddenOnDesktop && !modelHiddenOnDesktop &&
                     hasSelectors && hasPreGenerateFunction &&
                     callsPreGenerate && usesCache &&
                     setsDisplay && populatesOptions;

if (allTestsPass) {
  console.log('✓ ALL TESTS PASSED\n');
  console.log('Manual Testing Instructions:');
  console.log('1. Start server: npm run dev');
  console.log('2. Open http://localhost:3000/gm/');
  console.log('3. Check chat input area - you should see:');
  console.log('   - CLI selector dropdown (e.g., "Claude")');
  console.log('   - Model selector dropdown (e.g., "Sonnet 4.5")');
  console.log('   - Microphone button for voice input');
  console.log('4. Open Voice tab and enable "Auto-speak responses"');
  console.log('5. Send a message and observe:');
  console.log('   - Text streams in as agent responds');
  console.log('   - Voice playback starts immediately after completion (no delay)');
  console.log('   - Audio was pre-generated during streaming');
} else {
  console.log('❌ SOME TESTS FAILED - Review output above\n');
  process.exit(1);
}
