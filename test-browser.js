#!/usr/bin/env node

/**
 * Browser Testing Harness
 * Manages repository cloning, Claude Code execution, and browser testing
 * for streaming event visualization
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const os = require('os');

class BrowserTestHarness {
  constructor(config = {}) {
    this.config = {
      baseDir: config.baseDir || path.join(os.tmpdir(), 'agentgui-test'),
      serverPort: config.serverPort || 3000,
      serverUrl: config.serverUrl || 'http://localhost:3000',
      baseURL: config.baseURL || '/gm',
      timeout: config.timeout || 30 * 60 * 1000, // 30 minutes
      concurrency: config.concurrency || 2,
      ...config
    };

    this.repos = [];
    this.executionLog = [];
    this.eventCounts = {};
  }

  /**
   * Initialize test environment
   */
  async init() {
    console.log('Initializing browser test harness');

    // Ensure base directory
    if (!fs.existsSync(this.config.baseDir)) {
      fs.mkdirSync(this.config.baseDir, { recursive: true });
    }

    console.log(`Test directory: ${this.config.baseDir}`);
    return this;
  }

  /**
   * Clone a repository
   */
  async cloneRepository(url, name) {
    console.log(`Cloning repository: ${url}`);

    const repoPath = path.join(this.config.baseDir, name);

    // Check if already cloned
    if (fs.existsSync(repoPath)) {
      console.log(`Repository already exists: ${repoPath}`);
      this.repos.push({
        url,
        name,
        path: repoPath,
        status: 'ready'
      });
      return repoPath;
    }

    try {
      execSync(`git clone --depth 1 ${url} ${repoPath}`, {
        stdio: 'pipe',
        timeout: 60000
      });

      const repo = {
        url,
        name,
        path: repoPath,
        status: 'cloned',
        fileCount: this.countFiles(repoPath),
        languages: this.detectLanguages(repoPath)
      };

      this.repos.push(repo);
      console.log(`Repository cloned successfully: ${repo.fileCount} files`);
      return repoPath;
    } catch (error) {
      console.error(`Failed to clone repository: ${error.message}`);
      throw error;
    }
  }

  /**
   * Count files in repository
   */
  countFiles(dirPath) {
    let count = 0;
    const walk = (dir) => {
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          if (fs.statSync(fullPath).isDirectory()) {
            if (!file.startsWith('.') && file !== 'node_modules') {
              walk(fullPath);
            }
          } else {
            count++;
          }
        }
      } catch (e) {
        // Ignore
      }
    };
    walk(dirPath);
    return count;
  }

  /**
   * Detect languages in repository
   */
  detectLanguages(dirPath) {
    const langMap = {
      '.js': 'JavaScript',
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript',
      '.jsx': 'JavaScript',
      '.py': 'Python',
      '.java': 'Java',
      '.cpp': 'C++',
      '.c': 'C',
      '.cs': 'C#',
      '.go': 'Go',
      '.rs': 'Rust',
      '.rb': 'Ruby',
      '.php': 'PHP',
      '.json': 'JSON'
    };

    const languages = new Set();
    const walk = (dir) => {
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (file.startsWith('.') || file === 'node_modules') continue;
          const fullPath = path.join(dir, file);
          if (fs.statSync(fullPath).isDirectory()) {
            walk(fullPath);
          } else {
            const ext = path.extname(file).toLowerCase();
            if (langMap[ext]) {
              languages.add(langMap[ext]);
            }
          }
        }
      } catch (e) {
        // Ignore
      }
    };
    walk(dirPath);
    return Array.from(languages);
  }

  /**
   * Execute Claude Code on repository
   */
  async executeClaudeCode(repoPath, command, agentId = 'claude-code') {
    console.log(`Executing Claude Code: ${command.substring(0, 50)}...`);

    const execution = {
      repoPath,
      command,
      agentId,
      startTime: Date.now(),
      events: [],
      status: 'running'
    };

    try {
      // Execute Claude Code with streaming output
      const result = await this.runClaudeCode(repoPath, command, agentId);

      execution.endTime = Date.now();
      execution.duration = execution.endTime - execution.startTime;
      execution.eventCount = result.events.length;
      execution.events = result.events;
      execution.status = 'completed';
      execution.output = result.output;
      execution.error = null;
    } catch (error) {
      execution.endTime = Date.now();
      execution.duration = execution.endTime - execution.startTime;
      execution.status = 'failed';
      execution.error = error.message;
    }

    this.executionLog.push(execution);
    return execution;
  }

  /**
   * Run Claude Code command
   */
  async runClaudeCode(cwd, command, agentId) {
    return new Promise((resolve, reject) => {
      try {
        const cmd = agentId === 'claude-code' ? 'claude' : 'opencode';
        const fullCommand = `${cmd} ${command}`;

        console.log(`Running: ${fullCommand} (cwd: ${cwd})`);

        const proc = spawn('sh', ['-c', fullCommand], {
          cwd,
          timeout: this.config.timeout,
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        proc.on('close', (code) => {
          const events = this.parseStreamingOutput(stdout + stderr);

          resolve({
            events,
            output: stdout,
            stderr,
            exitCode: code
          });
        });

        proc.on('error', (error) => {
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Parse streaming output to extract events
   */
  parseStreamingOutput(output) {
    const events = [];

    // Try to parse JSON stream (stream-json format)
    const lines = output.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        if (json.type) {
          events.push(json);
          this.eventCounts[json.type] = (this.eventCounts[json.type] || 0) + 1;
        }
      } catch (e) {
        // Not JSON, skip
      }
    }

    return events;
  }

  /**
   * Simulate browser test scenario
   */
  async testScenario(name, repoPath, command, expectedEventTypes = []) {
    console.log(`\n=== Test Scenario: ${name} ===`);

    try {
      const execution = await this.executeClaudeCode(repoPath, command);

      // Verify events
      const eventTypes = execution.events.map(e => e.type);
      const hasExpectedEvents = expectedEventTypes.every(type =>
        eventTypes.includes(type)
      );

      const result = {
        name,
        status: execution.status,
        duration: execution.duration,
        eventCount: execution.eventCount,
        eventTypes,
        hasExpectedEvents,
        passed: execution.status === 'completed' && hasExpectedEvents,
        error: execution.error
      };

      console.log(`Result: ${result.passed ? 'PASSED' : 'FAILED'}`);
      console.log(`Duration: ${(result.duration / 1000).toFixed(2)}s`);
      console.log(`Events: ${result.eventCount} (types: ${eventTypes.join(', ')})`);

      return result;
    } catch (error) {
      console.error(`Test failed with error: ${error.message}`);
      return {
        name,
        status: 'error',
        passed: false,
        error: error.message
      };
    }
  }

  /**
   * Run all test scenarios
   */
  async runAllScenarios() {
    console.log('\n\n=== BROWSER TEST EXECUTION ===\n');

    const results = [];

    // Clone test repositories
    console.log('\n--- Repository Setup ---');
    const repoURLs = [
      { url: 'https://github.com/lodash/lodash', name: 'lodash' },
      { url: 'https://github.com/requests/requests', name: 'requests' },
      { url: 'https://github.com/kubernetes/kubernetes', name: 'kubernetes' }
    ];

    for (const repo of repoURLs) {
      try {
        await this.cloneRepository(repo.url, repo.name);
      } catch (error) {
        console.error(`Failed to clone ${repo.name}: ${error.message}`);
      }
    }

    // Run test scenarios
    console.log('\n--- Test Scenarios ---');

    if (this.repos.length > 0) {
      const repo1 = this.repos[0];
      if (repo1.path) {
        // Test 1: Analyze files
        results.push(await this.testScenario(
          'Analyze JavaScript files',
          repo1.path,
          'ls -la | head -20',
          ['file_read', 'command_execute']
        ));

        // Test 2: View file structure
        results.push(await this.testScenario(
          'Explore directory structure',
          repo1.path,
          'find . -name "*.md" | head -10',
          ['command_execute']
        ));
      }
    }

    return results;
  }

  /**
   * Generate test report
   */
  generateReport() {
    const passed = this.executionLog.filter(e => e.status === 'completed').length;
    const failed = this.executionLog.filter(e => e.status === 'failed').length;
    const totalEvents = Object.values(this.eventCounts).reduce((a, b) => a + b, 0);

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalExecutions: this.executionLog.length,
        passed,
        failed,
        successRate: this.executionLog.length > 0 ? (passed / this.executionLog.length * 100).toFixed(2) + '%' : 'N/A'
      },
      repositories: this.repos.map(r => ({
        name: r.name,
        fileCount: r.fileCount,
        languages: r.languages,
        path: r.path
      })),
      events: {
        totalCount: totalEvents,
        byType: this.eventCounts
      },
      executions: this.executionLog.map(e => ({
        command: e.command,
        status: e.status,
        duration: `${(e.duration / 1000).toFixed(2)}s`,
        eventCount: e.eventCount,
        error: e.error
      }))
    };

    return report;
  }

  /**
   * Save report to file
   */
  saveReport(filepath) {
    const report = this.generateReport();
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
    console.log(`Report saved: ${filepath}`);
    return report;
  }

  /**
   * Cleanup test environment
   */
  async cleanup() {
    console.log('\nCleaning up test environment...');

    try {
      if (fs.existsSync(this.config.baseDir)) {
        execSync(`rm -rf ${this.config.baseDir}`, { timeout: 30000 });
        console.log('Test directory cleaned up');
      }
    } catch (error) {
      console.error(`Cleanup error: ${error.message}`);
    }
  }
}

// CLI usage
if (require.main === module) {
  (async () => {
    const harness = new BrowserTestHarness({
      baseDir: path.join(os.tmpdir(), 'agentgui-test-' + Date.now())
    });

    try {
      await harness.init();
      const results = await harness.runAllScenarios();

      // Save report
      const reportPath = path.join(process.cwd(), 'test-report.json');
      const report = harness.saveReport(reportPath);

      console.log('\n=== FINAL REPORT ===');
      console.log(JSON.stringify(report.summary, null, 2));

      // Cleanup
      await harness.cleanup();

      process.exit(results.every(r => r.passed) ? 0 : 1);
    } catch (error) {
      console.error('Fatal error:', error);
      process.exit(1);
    }
  })();
}

module.exports = BrowserTestHarness;
