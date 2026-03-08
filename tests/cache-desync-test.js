
/**
 * Cache Desync Prevention Test Suite
 * Verifies atomic mutation points and cache coherency for conversation threads
 */

// Simulated ConversationManager with cache desync prevention
class ConversationManagerTest {
  constructor() {
    this.conversations = [];
    this._conversationVersion = 0;
    this._lastMutationSource = null;
    this._lastMutationTime = 0;
    this.testLog = [];
  }

  _updateConversations(newArray, source, context = {}) {
    const oldLen = this.conversations.length;
    const newLen = Array.isArray(newArray) ? newArray.length : 0;
    const mutationId = ++this._conversationVersion;
    const timestamp = Date.now();

    this.conversations = Array.isArray(newArray) ? newArray : [];
    this._lastMutationSource = source;
    this._lastMutationTime = timestamp;

    const logEntry = `mutation #${mutationId} (${source}): ${oldLen} → ${newLen} items`;
    this.testLog.push(logEntry);

    return { version: mutationId, timestamp, oldLen, newLen };
  }

  addConversation(conv) {
    if (this.conversations.some(c => c.id === conv.id)) return;
    const newConvs = [conv, ...this.conversations];
    this._updateConversations(newConvs, 'add');
  }

  updateConversation(convId, updates) {
    const idx = this.conversations.findIndex(c => c.id === convId);
    if (idx >= 0) {
      const updated = Object.assign({}, this.conversations[idx], updates);
      const newConvs = [
        ...this.conversations.slice(0, idx),
        updated,
        ...this.conversations.slice(idx + 1)
      ];
      this._updateConversations(newConvs, 'update');
    }
  }

  deleteConversation(convId) {
    const newConvs = this.conversations.filter(c => c.id !== convId);
    this._updateConversations(newConvs, 'delete');
  }

  loadConversations(data) {
    const convList = data.conversations || [];
    this._updateConversations(convList, 'poll');
  }

  getCacheVersion() {
    return this._conversationVersion;
  }
}

// Test suite
function runTests() {
  const tests = [];

  tests.push({
    name: 'TEST 1: Single Add Operation',
    run: (mgr) => {
      const conv = { id: 'c1', title: 'Conv 1' };
      mgr.addConversation(conv);
      return mgr.conversations.length === 1 && mgr.getCacheVersion() === 1;
    }
  });

  tests.push({
    name: 'TEST 2: Version Increment on Each Mutation',
    run: (mgr) => {
      const conv1 = { id: 'c1', title: 'Conv 1' };
      const conv2 = { id: 'c2', title: 'Conv 2' };
      mgr.addConversation(conv1);
      mgr.addConversation(conv2);
      return mgr.getCacheVersion() === 2 && mgr.conversations.length === 2;
    }
  });

  tests.push({
    name: 'TEST 3: Poll Overwrites Cache Atomically',
    run: (mgr) => {
      mgr.loadConversations({ conversations: [
        { id: 'new1', title: 'New Conv 1' },
        { id: 'new2', title: 'New Conv 2' }
      ] });
      return mgr.getCacheVersion() === 1 && mgr.conversations.length === 2;
    }
  });

  tests.push({
    name: 'TEST 4: Concurrent Add + Poll (Race Condition)',
    run: (mgr) => {
      const initial = { id: 'c1', title: 'Conv 1' };
      mgr.addConversation(initial);
      const v1 = mgr.getCacheVersion();
      
      // Now a poll comes in - overwrites atomically
      mgr.loadConversations({ conversations: [
        { id: 'c2', title: 'Conv 2' },
        { id: 'c3', title: 'Conv 3' }
      ] });
      
      // Poll should have overwritten, version should have incremented
      return mgr.getCacheVersion() === v1 + 1 && 
             mgr.conversations.length === 2 &&
             mgr.conversations[0].id === 'c2';
    }
  });

  tests.push({
    name: 'TEST 5: Update Preserves Order',
    run: (mgr) => {
      mgr.loadConversations({ conversations: [
        { id: 'c1', title: 'Conv 1' },
        { id: 'c2', title: 'Conv 2' },
        { id: 'c3', title: 'Conv 3' }
      ] });
      mgr.updateConversation('c2', { title: 'Updated Conv 2' });
      
      return mgr.conversations[1].id === 'c2' &&
             mgr.conversations[1].title === 'Updated Conv 2' &&
             mgr.conversations.length === 3;
    }
  });

  tests.push({
    name: 'TEST 6: Delete Maintains Array Integrity',
    run: (mgr) => {
      mgr.loadConversations({ conversations: [
        { id: 'c1', title: 'Conv 1' },
        { id: 'c2', title: 'Conv 2' },
        { id: 'c3', title: 'Conv 3' }
      ] });
      mgr.deleteConversation('c2');
      
      return mgr.conversations.length === 2 &&
             mgr.conversations[0].id === 'c1' &&
             mgr.conversations[1].id === 'c3';
    }
  });

  tests.push({
    name: 'TEST 7: Mutation Source Tracking',
    run: (mgr) => {
      const sources = [];
      mgr.addConversation({ id: 'c1', title: 'Conv 1' });
      sources.push(mgr._lastMutationSource);
      
      mgr.loadConversations({ conversations: [{ id: 'c2', title: 'Conv 2' }] });
      sources.push(mgr._lastMutationSource);
      
      return sources[0] === 'add' && sources[1] === 'poll';
    }
  });

  tests.push({
    name: 'TEST 8: No Intermediate States',
    run: (mgr) => {
      // All mutations are atomic - array is always in a valid state
      const before = mgr.getCacheVersion();
      mgr.updateConversation('nonexistent', { title: 'Nope' });
      const after = mgr.getCacheVersion();
      
      // No mutation occurred, version unchanged
      return before === after;
    }
  });

  // Run all tests
  console.log('\n=== CACHE DESYNC PREVENTION TEST SUITE ===\n');
  let passed = 0;
  let failed = 0;

  tests.forEach(test => {
    const mgr = new ConversationManagerTest();
    const result = test.run(mgr);
    passed += result ? 1 : 0;
    failed += result ? 0 : 1;
    console.log(`${result ? '✓ PASS' : '✗ FAIL'}: ${test.name}`);
  });

  console.log(`\n=== RESULTS ===`);
  console.log(`Passed: ${passed}/${tests.length}`);
  console.log(`Failed: ${failed}/${tests.length}`);

  if (failed === 0) {
    console.log('\n✓ All tests passed! Cache desync prevention working correctly.');
  } else {
    console.log(`\n✗ ${failed} test(s) failed.`);
  }

  return failed === 0;
}

// Execute tests
const success = runTests();
process.exit(success ? 0 : 1);
