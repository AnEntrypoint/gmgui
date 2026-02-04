import { spawn } from 'child_process';
import path from 'path';

/**
 * CLILauncher - Spawns the actual claude CLI tool with real plugins and streaming
 *
 * Uses:
 * - claude --print --output-format stream-json --include-partial-messages
 * - Sets cwd to the folder context for real filesystem work
 * - Captures streaming JSON output in real-time
 * - No SDK, no HTML wrapping, no system prompt interference
 */
export default class CLILauncher {
  constructor() {
    this.process = null;
    this.onUpdate = null;
  }

  async connect(agentType, cwd) {
    console.log(`[CLILauncher] Using claude CLI (${agentType})`);
    return { connected: true };
  }

  async initialize() {
    return { ready: true };
  }

  async newSession(cwd) {
    this.sessionId = Math.random().toString(36).substring(7);
    this.cwd = cwd || process.cwd();
    console.log(`[CLILauncher] Session ${this.sessionId} in ${this.cwd}`);
    return { sessionId: this.sessionId };
  }

  async setSessionMode(modeId) {
    this.modeId = modeId;
    return { modeId };
  }

  async injectSkills() {
    return { skills: [] };
  }

  async injectSystemContext() {
    return { context: 'Using real Claude CLI' };
  }

  /**
   * Send prompt to claude CLI and stream results
   * Returns the full response collected from streaming output
   */
  async sendPrompt(prompt) {
    const promptText = typeof prompt === 'string' ? prompt : prompt.map(p => p.text).join('\n');

    return new Promise((resolve, reject) => {
      try {
        // Get the actual claude command path
        const claudeCmd = path.resolve(
          process.cwd(),
          'node_modules/.bin/claude'
        );

        console.log(`[CLILauncher] Spawning claude CLI: ${claudeCmd}`);
        console.log(`[CLILauncher] Working directory: ${this.cwd}`);
        console.log(`[CLILauncher] Prompt length: ${promptText.length} chars`);

        // Spawn the CLI with streaming output
        // Use --input-format text and provide prompt via stdin
        this.process = spawn(claudeCmd, [
          '--print',
          '--input-format', 'text',
          '--output-format', 'json',
          '--dangerously-skip-permissions'
        ], {
          cwd: this.cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 300000 // 5 minute timeout
        });

        let fullResponse = '';
        let stderr = '';
        let resultJson = null;

        // Write prompt to stdin and close it
        this.process.stdin.write(promptText);
        this.process.stdin.end();

        console.log(`[CLILauncher] Prompt sent to stdin`);

        // Collect stdout (should be single JSON result)
        let stdoutBuffer = '';
        this.process.stdout.on('data', (chunk) => {
          stdoutBuffer += chunk.toString();
        });

        // Handle stderr (errors)
        this.process.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
          console.error(`[CLILauncher] stderr: ${chunk.toString()}`);
        });

        // Handle process exit
        this.process.on('close', (code) => {
          console.log(`[CLILauncher] Process exited with code ${code}`);

          if (code !== 0) {
            console.error(`[CLILauncher] Error output: ${stderr}`);
            reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
            return;
          }

          // Parse the JSON result
          try {
            resultJson = JSON.parse(stdoutBuffer);

            // Extract the result text from the response
            if (resultJson.result) {
              fullResponse = String(resultJson.result);

              // Emit update for display FIRST (during processing)
              // This ensures the onUpdate callback is called and fullText is captured
              if (this.onUpdate && fullResponse) {
                console.log(`[CLILauncher] Emitting update with ${fullResponse.length} chars`);
                this.onUpdate({
                  update: {
                    sessionUpdate: 'agent_message_chunk',
                    content: { text: fullResponse }
                  }
                });
              }
            }

            console.log(`[CLILauncher] Response collected: ${fullResponse.length} chars`);
            console.log(`[CLILauncher] Session ID: ${resultJson.session_id}`);
            console.log(`[CLILauncher] Model: ${resultJson.modelUsage ? Object.keys(resultJson.modelUsage)[0] : 'unknown'}`);

            resolve({
              content: fullResponse,
              stopReason: 'end_turn',
              result: fullResponse,
              sessionId: resultJson.session_id,
              usage: resultJson.usage
            });

          } catch (parseErr) {
            console.error(`[CLILauncher] JSON parse error: ${parseErr.message}`);
            console.error(`[CLILauncher] Raw output: ${stdoutBuffer.substring(0, 500)}`);
            reject(new Error(`Failed to parse Claude CLI response: ${parseErr.message}`));
          }
        });

        // Handle process errors
        this.process.on('error', (err) => {
          console.error(`[CLILauncher] Process error: ${err.message}`);
          reject(err);
        });

      } catch (err) {
        console.error(`[CLILauncher] Setup error: ${err.message}`);
        reject(err);
      }
    });
  }

  isRunning() {
    return this.process && !this.process.killed;
  }

  async terminate() {
    if (this.process && !this.process.killed) {
      console.log(`[CLILauncher] Terminating process`);
      this.process.kill('SIGTERM');

      // Give it a moment to die gracefully
      return new Promise(resolve => {
        setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.kill('SIGKILL');
          }
          resolve();
        }, 1000);
      });
    }
  }
}
