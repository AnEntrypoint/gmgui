// Verify run cancellation implementation without needing running server
import fs from 'fs';

const serverContent = fs.readFileSync('/config/workspace/agentgui/server.js', 'utf-8');

console.log('=== VERIFYING RUN CANCELLATION IMPLEMENTATION ===\n');

const checks = [
  {
    name: 'Enhanced /api/runs/{run_id}/cancel endpoint',
    test: () => {
      const hasGetRun = serverContent.includes('acpQueries.getRun(runId)') || serverContent.includes('queries.getRun(runId)');
      const hasStatusCheck = serverContent.includes("['success', 'error', 'cancelled'].includes");
      const has409 = serverContent.includes('sendJSON(req, res, 409');
      return hasGetRun && hasStatusCheck && has409;
    }
  },
  {
    name: 'Process termination with SIGTERM then SIGKILL',
    test: () => {
      const hasSigterm = serverContent.includes("process.kill(-execution.pid, 'SIGTERM')") ||
                         serverContent.includes("process.kill(execution.pid, 'SIGTERM')");
      const hasSigkill = serverContent.includes("'SIGKILL'");
      const hasTimeout = serverContent.includes('setTimeout') && serverContent.includes('3000');
      return hasSigterm && hasSigkill && hasTimeout;
    }
  },
  {
    name: 'WebSocket broadcast on cancellation',
    test: () => {
      return serverContent.includes("type: 'streaming_cancelled'") &&
             serverContent.includes('broadcastSync');
    }
  },
  {
    name: 'Active executions cleanup',
    test: () => {
      return serverContent.includes('activeExecutions.delete(threadId)') &&
             serverContent.includes('queries.setIsStreaming(threadId, false)');
    }
  },
  {
    name: 'Thread-based cancel endpoint /api/threads/{thread_id}/runs/{run_id}/cancel',
    test: () => {
      return serverContent.includes('threadRunCancelMatch') &&
             serverContent.includes('/api/threads/([^/]+)/runs/([^/]+)/cancel');
    }
  },
  {
    name: 'Thread-based wait endpoint /api/threads/{thread_id}/runs/{run_id}/wait',
    test: () => {
      return serverContent.includes('threadRunWaitMatch') &&
             serverContent.includes('/api/threads/([^/]+)/runs/([^/]+)/wait');
    }
  },
  {
    name: 'Wait endpoint long-polling (30s timeout, 500ms poll)',
    test: () => {
      const hasWait = serverContent.includes('/wait') && serverContent.includes('GET');
      const hasPoll = serverContent.includes('setInterval') && serverContent.includes('500');
      const hasTimeout = serverContent.includes('30000');
      return hasWait && hasPoll && hasTimeout;
    }
  },
  {
    name: 'Thread validation in thread-based endpoints',
    test: () => {
      return serverContent.includes('run.thread_id !== threadId') &&
             serverContent.includes('Run does not belong to specified thread');
    }
  },
  {
    name: 'Session status update on cancellation',
    test: () => {
      return serverContent.includes("status: 'error'") &&
             serverContent.includes("error: 'Cancelled by user'");
    }
  },
  {
    name: 'Database run status update to cancelled',
    test: () => {
      const hasCancelRun = serverContent.includes('cancelRun(runId)') ||
                           serverContent.includes('cancelledRun');
      const hasUpdateStatus = serverContent.includes('updateRunStatus');
      return hasCancelRun || hasUpdateStatus;
    }
  }
];

let passed = 0;
let failed = 0;

checks.forEach(check => {
  try {
    const result = check.test();
    if (result) {
      console.log(`✓ ${check.name}`);
      passed++;
    } else {
      console.log(`✗ ${check.name}`);
      failed++;
    }
  } catch (e) {
    console.log(`✗ ${check.name} (error: ${e.message})`);
    failed++;
  }
});

console.log(`\n=== SUMMARY ===`);
console.log(`Passed: ${passed}/${checks.length}`);
console.log(`Failed: ${failed}/${checks.length}`);

if (passed === checks.length) {
  console.log('\n✓ ALL IMPLEMENTATION CHECKS PASSED');
  process.exit(0);
} else {
  console.log('\n✗ SOME IMPLEMENTATION CHECKS FAILED');
  process.exit(1);
}
