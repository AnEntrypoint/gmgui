import { spawn } from 'child_process';

/**
 * Configuration for Claude runner
 * @typedef {Object} ClaudeRunnerConfig
 * @property {boolean} [skipPermissions=false] - Use --dangerously-skip-permissions flag
 * @property {boolean} [verbose=true] - Use --verbose flag
 * @property {string} [outputFormat='stream-json'] - Output format (stream-json, json, text)
 * @property {number} [timeout=300000] - Timeout in milliseconds (default 5 minutes)
 * @property {boolean} [print=true] - Use --print flag
 */

/**
 * Run Claude with streaming JSON output
 * @param {string} prompt - The prompt to send to Claude
 * @param {string} cwd - Working directory
 * @param {string} agentId - Agent identifier (for logging)
 * @param {ClaudeRunnerConfig} [config={}] - Configuration options
 * @returns {Promise<Array>} Array of parsed JSON objects from Claude output
 */
export async function runClaudeWithStreaming(prompt, cwd, agentId = 'claude-code', config = {}) {
  return new Promise((resolve, reject) => {
    const {
      skipPermissions = false,
      verbose = true,
      outputFormat = 'stream-json',
      timeout = 300000,
      print = true
    } = config;

    // Build flags array
    const flags = [];
    if (print) flags.push('--print');
    if (verbose) flags.push('--verbose');
    flags.push(`--output-format=${outputFormat}`);
    if (skipPermissions) flags.push('--dangerously-skip-permissions');

    const proc = spawn('claude', flags, { cwd });
    let jsonBuffer = '';
    const outputs = [];
    let timedOut = false;

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      proc.kill();
      reject(new Error(`Claude CLI timeout after ${timeout}ms for agent ${agentId}`));
    }, timeout);

    proc.stdin.write(prompt);
    proc.stdin.end();

    proc.stdout.on('data', (chunk) => {
      if (timedOut) return;

      jsonBuffer += chunk.toString();
      const lines = jsonBuffer.split('\n');
      jsonBuffer = lines.pop();

      for (const line of lines) {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);
            outputs.push(parsed);
          } catch (e) {
            console.error(`[claude-runner] JSON parse error on line: ${line.substring(0, 100)}`);
          }
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      console.error(`[claude-runner] stderr: ${chunk.toString()}`);
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutHandle);
      if (timedOut) return;

      if (code === 0) {
        if (jsonBuffer.trim()) {
          try {
            outputs.push(JSON.parse(jsonBuffer));
          } catch (e) {
            console.error(`[claude-runner] Final JSON parse error: ${jsonBuffer.substring(0, 100)}`);
          }
        }
        resolve(outputs);
      } else {
        reject(new Error(`Claude CLI exited with code ${code} for agent ${agentId}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutHandle);
      reject(err);
    });
  });
}

export default runClaudeWithStreaming;
