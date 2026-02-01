import { spawn } from 'child_process';
import { EventEmitter } from 'events';

export class ACPLauncher extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.sessionMap = new Map();
    this.inputBuffer = [];
    this.isProcessing = false;
  }

  async launch(agentPath = 'claude-code-acp', agent = 'claude-code') {
    return new Promise((resolve, reject) => {
      try {
        const command = agent === 'opencode' ? 'opencode acp' : agentPath;
        console.log(`Launching ACP agent: ${command}`);

        const args = agent === 'opencode' ? [] : [];
        const stdio = agent === 'opencode' ? ['pipe', 'pipe', 'inherit'] : ['pipe', 'pipe', 'inherit'];

        try {
          this.process = agent === 'opencode'
            ? spawn('opencode', ['acp'], {
                stdio,
                env: {
                  ...process.env,
                  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
                },
              })
            : spawn(agentPath, args, {
                stdio,
                env: {
                  ...process.env,
                  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
                },
              });
        } catch (spawnErr) {
          console.error(`Failed to spawn ACP process: ${spawnErr.message}`);
          reject(new Error(`Failed to spawn ACP agent: ${spawnErr.message}`));
          return;
        }

        if (!this.process) {
          reject(new Error('Process creation returned null'));
          return;
        }

        this.process.on('error', (err) => {
          console.error('ACP process error:', err);
          this.emit('error', err);
          reject(err);
        });

        this.process.on('exit', (code, signal) => {
          console.log(`ACP process exited with code ${code} signal ${signal}`);
          this.process = null;
          this.emit('exit', { code, signal });
        });

        if (this.process.stdout) {
          this.process.stdout.setEncoding('utf8');
          this.process.stdout.on('data', (data) => {
            this.handleOutput(data);
          });
        }

        if (this.process.stderr) {
          this.process.stderr.on('data', (data) => {
            console.error('ACP stderr:', data.toString());
          });
        }

        setTimeout(() => resolve(), 500);
      } catch (err) {
        console.error('Launch error:', err);
        reject(err);
      }
    });
  }

  handleOutput(data) {
    const lines = data.split('\n');
    
    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line);
        this.emit('message', message);
      } catch (err) {
        console.error('Failed to parse ACP message:', line, err);
      }
    }
  }

  async initialize() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('ACP initialize timeout'));
      }, 15000); // Increased from 5s to 15s for slower systems

      const handleMessage = (msg) => {
        if (msg.result?.protocolVersion) {
          clearTimeout(timeout);
          this.removeListener('message', handleMessage);
          resolve(msg.result);
        }
      };

      this.on('message', handleMessage);

      const initRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          clientCapabilities: {
            fs: true,
            terminal: true,
          },
        },
      };

      this.send(initRequest);
    });
  }

  async createSession(cwd, sessionId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('ACP newSession timeout'));
      }, 5000);

      const handleMessage = (msg) => {
        if (msg.result?.sessionId === sessionId) {
          clearTimeout(timeout);
          this.removeListener('message', handleMessage);
          this.sessionMap.set(sessionId, { cwd, active: true });
          resolve(msg.result);
        }
      };

      this.on('message', handleMessage);

      const newSessionRequest = {
        jsonrpc: '2.0',
        id: 2,
        method: 'newSession',
        params: {
          cwd,
          mcpServers: [],
        },
      };

      this.send(newSessionRequest);
    });
  }

  async sendPrompt(sessionId, messages, systemPrompt = null) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('ACP prompt timeout'));
      }, 300000);

      const responses = [];
      const handleMessage = (msg) => {
        if (msg.method === 'sessionUpdate' && msg.params?.sessionId === sessionId) {
          responses.push(msg.params);
        }

        if (msg.result?.stopReason) {
          clearTimeout(timeout);
          this.removeListener('message', handleMessage);
          resolve({
            stopReason: msg.result.stopReason,
            updates: responses,
          });
        }
      };

      this.on('message', handleMessage);

      const promptRequest = {
        jsonrpc: '2.0',
        id: 3,
        method: 'prompt',
        params: {
          sessionId,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          systemPrompt,
        },
      };

      this.send(promptRequest);
    });
  }

  send(request) {
    if (!this.process || !this.process.stdin) {
      throw new Error('ACP process not running');
    }

    const line = JSON.stringify(request) + '\n';
    this.process.stdin.write(line, (err) => {
      if (err) {
        console.error('Failed to send ACP request:', err);
        this.emit('error', err);
      }
    });
  }

  async terminate() {
    return new Promise((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        console.warn('ACP process did not exit gracefully, killing...');
        this.process?.kill('SIGKILL');
        resolve();
      }, 5000);

      this.process.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.process.stdin?.end();
      this.process.kill('SIGTERM');
    });
  }

  isRunning() {
    return this.process && !this.process.killed;
  }

  getSession(sessionId) {
    return this.sessionMap.get(sessionId);
  }

  getSessions() {
    return Array.from(this.sessionMap.entries()).map(([id, data]) => ({
      sessionId: id,
      ...data,
    }));
  }
}

export default ACPLauncher;
