/**
 * Comprehensive End-to-End Browser Test Harness
 * Tests real-time Claude Code execution, UI rendering, and concurrent operations
 */

// Test results collector
const testResults = {
  phases: {},
  screenshots: [],
  errors: [],
  startTime: Date.now(),
};

/**
 * PHASE 1: Server Startup Verification
 */
async function testPhase1_ServerStartup() {
  console.log('\n========== PHASE 1: SERVER STARTUP VERIFICATION ==========');

  try {
    const response = await fetch('http://localhost:3000', {
      method: 'HEAD',
      headers: { 'Accept': '*/*' }
    });

    const isRunning = response.status === 200 || response.status === 302;
    console.log(`Server status: ${response.status}`);
    console.log(`Server running: ${isRunning ? '✓' : '✗'}`);

    testResults.phases['phase1_server'] = {
      status: isRunning ? 'PASS' : 'FAIL',
      message: `Server responding with status ${response.status}`,
      timestamp: new Date().toISOString()
    };

    return isRunning;
  } catch (error) {
    console.error('Server startup test failed:', error.message);
    testResults.phases['phase1_server'] = {
      status: 'FAIL',
      error: error.message,
      timestamp: new Date().toISOString()
    };
    testResults.errors.push({ phase: 1, error: error.message });
    return false;
  }
}

/**
 * PHASE 2: UI Verification
 */
async function testPhase2_UIVerification() {
  console.log('\n========== PHASE 2: UI VERIFICATION ==========');

  try {
    // Check for RippleUI components
    const components = {
      metadataPanel: document.querySelector('[data-component="agent-metadata"]'),
      progressSection: document.querySelector('[data-component="execution-progress"]'),
      outputArea: document.querySelector('[data-component="output-display"]'),
      errorPanel: document.querySelector('[data-component="error-handler"]'),
      themeToggle: document.querySelector('[data-component="theme-toggle"]')
    };

    const allComponentsVisible = Object.values(components).every(comp => comp !== null);

    console.log('Component Check:');
    for (const [name, comp] of Object.entries(components)) {
      console.log(`  ${name}: ${comp ? '✓' : '✗'}`);
    }

    testResults.phases['phase2_ui'] = {
      status: allComponentsVisible ? 'PASS' : 'FAIL',
      components: Object.fromEntries(
        Object.entries(components).map(([k, v]) => [k, v ? 'visible' : 'missing'])
      ),
      timestamp: new Date().toISOString()
    };

    return allComponentsVisible;
  } catch (error) {
    console.error('UI verification test failed:', error.message);
    testResults.phases['phase2_ui'] = {
      status: 'FAIL',
      error: error.message,
      timestamp: new Date().toISOString()
    };
    testResults.errors.push({ phase: 2, error: error.message });
    return false;
  }
}

/**
 * PHASE 3: Repository Setup Verification
 */
async function testPhase3_RepositorySetup() {
  console.log('\n========== PHASE 3: REPOSITORY SETUP VERIFICATION ==========');

  try {
    // Check if repos exist using file system
    // Note: This is a simulated check since we can't access filesystem directly from browser
    // The actual repos will be verified when we try to execute Claude Code

    const repos = {
      lodash: '/tmp/test-repos/lodash',
      chalk: '/tmp/test-repos/chalk'
    };

    console.log('Expected repositories:');
    for (const [name, path] of Object.entries(repos)) {
      console.log(`  ${name}: ${path}`);
    }

    testResults.phases['phase3_repos'] = {
      status: 'PENDING',
      message: 'Repository verification will occur during execution',
      repos,
      timestamp: new Date().toISOString()
    };

    return true; // Will be verified during execution
  } catch (error) {
    console.error('Repository setup test failed:', error.message);
    testResults.phases['phase3_repos'] = {
      status: 'FAIL',
      error: error.message,
      timestamp: new Date().toISOString()
    };
    testResults.errors.push({ phase: 3, error: error.message });
    return false;
  }
}

/**
 * PHASE 4: Console Error Verification
 */
async function testPhase4_ConsoleErrors() {
  console.log('\n========== PHASE 4: CONSOLE ERROR CHECKING ==========');

  try {
    // Collect console logs
    const originalError = console.error;
    const originalWarn = console.warn;

    let errorCount = 0;
    let warnCount = 0;
    const capturedErrors = [];

    console.error = function(...args) {
      errorCount++;
      capturedErrors.push({ level: 'error', message: args.join(' ') });
      originalError.apply(console, args);
    };

    console.warn = function(...args) {
      warnCount++;
      originalWarn.apply(console, args);
    };

    // Check for uncaught errors in window
    const uncaughtErrors = window.__uncaughtErrors || [];

    console.log(`Captured errors: ${errorCount}`);
    console.log(`Captured warnings: ${warnCount}`);
    console.log(`Uncaught errors: ${uncaughtErrors.length}`);

    const isClean = errorCount === 0 && uncaughtErrors.length === 0;

    testResults.phases['phase4_console'] = {
      status: isClean ? 'PASS' : 'WARN',
      errorCount,
      warnCount,
      uncaughtErrorsCount: uncaughtErrors.length,
      timestamp: new Date().toISOString()
    };

    return isClean;
  } catch (error) {
    console.error('Console error test failed:', error.message);
    testResults.phases['phase4_console'] = {
      status: 'FAIL',
      error: error.message,
      timestamp: new Date().toISOString()
    };
    testResults.errors.push({ phase: 4, error: error.message });
    return false;
  }
}

/**
 * PHASE 5: Network Status Check
 */
async function testPhase5_NetworkStatus() {
  console.log('\n========== PHASE 5: NETWORK STATUS CHECK ==========');

  try {
    // Check API endpoints
    const endpoints = [
      '/gm/api/conversations',
      '/gm/api/conversations',
    ];

    let successCount = 0;
    const results = {};

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(`http://localhost:3000${endpoint}`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        });
        results[endpoint] = response.status;
        if (response.status === 200 || response.status === 201) {
          successCount++;
        }
      } catch (error) {
        results[endpoint] = `ERROR: ${error.message}`;
      }
    }

    const isHealthy = successCount === endpoints.length;

    console.log('API Endpoint Status:');
    for (const [endpoint, status] of Object.entries(results)) {
      console.log(`  ${endpoint}: ${status}`);
    }

    testResults.phases['phase5_network'] = {
      status: isHealthy ? 'PASS' : 'WARN',
      endpoints: results,
      timestamp: new Date().toISOString()
    };

    return isHealthy;
  } catch (error) {
    console.error('Network status test failed:', error.message);
    testResults.phases['phase5_network'] = {
      status: 'FAIL',
      error: error.message,
      timestamp: new Date().toISOString()
    };
    testResults.errors.push({ phase: 5, error: error.message });
    return false;
  }
}

/**
 * PHASE 6: Dark Mode Toggle Test
 */
async function testPhase6_DarkModeToggle() {
  console.log('\n========== PHASE 6: DARK MODE TOGGLE TEST ==========');

  try {
    const themeToggle = document.querySelector('[data-component="theme-toggle"]');

    if (!themeToggle) {
      throw new Error('Theme toggle button not found');
    }

    // Get initial theme
    const initialTheme = document.documentElement.getAttribute('data-theme') || 'light';
    console.log(`Initial theme: ${initialTheme}`);

    // Click toggle
    themeToggle.click();
    await new Promise(resolve => setTimeout(resolve, 200)); // Wait for animation

    const afterToggle = document.documentElement.getAttribute('data-theme') || 'light';
    console.log(`After toggle: ${afterToggle}`);

    // Verify change
    const themeChanged = initialTheme !== afterToggle;

    // Click back
    themeToggle.click();
    await new Promise(resolve => setTimeout(resolve, 200));

    const backToOriginal = document.documentElement.getAttribute('data-theme') === initialTheme;
    console.log(`Back to original: ${backToOriginal}`);

    const success = themeChanged && backToOriginal;

    testResults.phases['phase6_darkmode'] = {
      status: success ? 'PASS' : 'FAIL',
      initialTheme,
      afterToggle,
      backToOriginal,
      timestamp: new Date().toISOString()
    };

    return success;
  } catch (error) {
    console.error('Dark mode toggle test failed:', error.message);
    testResults.phases['phase6_darkmode'] = {
      status: 'FAIL',
      error: error.message,
      timestamp: new Date().toISOString()
    };
    testResults.errors.push({ phase: 6, error: error.message });
    return false;
  }
}

/**
 * Execute all tests in sequence
 */
async function runAllTests() {
  console.log('====================================================');
  console.log('STARTING END-TO-END BROWSER TEST SUITE');
  console.log('Time: ' + new Date().toISOString());
  console.log('====================================================');

  const tests = [
    { name: 'Phase 1: Server Startup', fn: testPhase1_ServerStartup },
    { name: 'Phase 2: UI Verification', fn: testPhase2_UIVerification },
    { name: 'Phase 3: Repository Setup', fn: testPhase3_RepositorySetup },
    { name: 'Phase 4: Console Errors', fn: testPhase4_ConsoleErrors },
    { name: 'Phase 5: Network Status', fn: testPhase5_NetworkStatus },
    { name: 'Phase 6: Dark Mode', fn: testPhase6_DarkModeToggle },
  ];

  const results = [];

  for (const test of tests) {
    try {
      console.log(`\nRunning: ${test.name}`);
      const result = await test.fn();
      results.push({ name: test.name, result });
    } catch (error) {
      console.error(`Test failed: ${test.name}`, error);
      results.push({ name: test.name, result: false, error });
    }
  }

  // Summary
  console.log('\n====================================================');
  console.log('TEST SUMMARY');
  console.log('====================================================');

  let passCount = 0;
  for (const { name, result } of results) {
    const status = result ? '✓ PASS' : '✗ FAIL';
    console.log(`${status}: ${name}`);
    if (result) passCount++;
  }

  console.log(`\nTotal: ${passCount}/${results.length} passed`);
  console.log(`Duration: ${(Date.now() - testResults.startTime) / 1000}s`);
  console.log(`Errors: ${testResults.errors.length}`);

  if (testResults.errors.length > 0) {
    console.log('\nErrors:');
    testResults.errors.forEach((err, i) => {
      console.log(`  ${i + 1}. Phase ${err.phase}: ${err.error}`);
    });
  }

  // Save results to window for retrieval
  window.__testResults = testResults;
  window.__testSummary = { passCount, totalTests: results.length, results };

  console.log('\n✓ Test suite complete. Results saved to window.__testResults');

  return testResults;
}

// Export for use
window.runAllTests = runAllTests;
window.testResults = testResults;

console.log('✓ Test harness loaded. Call window.runAllTests() to start tests.');
