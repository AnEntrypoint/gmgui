import { spawn } from 'child_process';
import fs from 'fs';

const CLAUDE_BIN = '/home/user/.local/bin/claude';

const RIPPLEUI_SYSTEM_PROMPT = `ALWAYS respond with HTML using RippleUI components. The chat renders HTML. Use: cards (class='card'), alerts (class='alert alert-info'), tables (class='table table-zebra'), badges (class='badge badge-primary'), buttons (class='btn btn-primary'). Wrap all responses in styled HTML with Tailwind CSS utility classes for layout.

RIPPLEUI COMPONENTS:
Cards: <div class="card bg-base-100 shadow-lg p-6"><h2 class="text-xl font-bold mb-2">Title</h2><p>Content</p></div>
Alerts: <div class="alert alert-info"><span>Message</span></div>
Tables: <div class="overflow-x-auto"><table class="table table-zebra"><thead><tr><th>Col</th></tr></thead><tbody><tr><td>Val</td></tr></tbody></table></div>
Badges: <span class="badge badge-primary">Tag</span>
Buttons: <button class="btn btn-primary">Action</button>
Code: <pre class="bg-base-200 p-4 rounded-lg overflow-x-auto"><code>code here</code></pre>
Lists: <ul class="list-none space-y-2"><li class="p-3 bg-base-200 rounded-lg">Item</li></ul>

Use Tailwind CSS utility classes for layout (flex, grid, gap-4, p-4, rounded, shadow).
ALWAYS wrap responses in styled HTML. Never send plain unstyled text.`;

export default class ACPConnection {
  constructor() {
    this.child = null;
    this.buffer = '';
    this.nextRequestId = 1;
    this.pendingRequests = new Map();
    this.sessionId = null;
    this.onUpdate = null;
    this.printMode = false;
    this.cwd = '/config';
  }

  async connect(agentType, cwd) {
    this.cwd = cwd;
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    delete env.NODE_INSPECT;
    delete env.NODE_DEBUG;

    try {
      await this._tryACP(agentType, cwd, env);
      console.log(`[ACP] Connected via ACP bridge (${agentType})`);
    } catch (acpErr) {
      console.log(`[ACP] Bridge failed: ${acpErr.message}`);
      console.log(`[ACP] Falling back to claude --print mode`);
      this.printMode = true;
      if (this.child) {
        try { this.child.kill('SIGTERM'); } catch (_) {}
        this.child = null;
      }
    }
  }

  _tryACP(agentType, cwd, env) {
    return new Promise((resolve, reject) => {
      try {
        if (agentType === 'opencode') {
          this.child = spawn('opencode', ['acp'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env, shell: false });
        } else {
          this.child = spawn('claude-code-acp', [], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env, shell: false });
        }
      } catch (err) {
        reject(new Error(`Failed to spawn ACP: ${err.message}`));
        return;
      }

      const timeoutId = setTimeout(() => {
        reject(new Error('ACP bridge timeout (5s)'));
      }, 5000);

      this.child.stderr.on('data', d => console.error(`[ACP:stderr]`, d.toString().trim()));
      this.child.on('error', err => {
        clearTimeout(timeoutId);
        reject(new Error(`ACP spawn error: ${err.message}`));
      });
      this.child.on('exit', (code, signal) => {
        clearTimeout(timeoutId);
        this.child = null;
        for (const [id, req] of this.pendingRequests) {
          req.reject(new Error('ACP process exited'));
          clearTimeout(req.timeoutId);
        }
        this.pendingRequests.clear();
      });

      this.child.stdout.setEncoding('utf8');
      this.child.stdout.on('data', data => {
        clearTimeout(timeoutId);
        this.buffer += data;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            this.handleMessage(JSON.parse(line));
          } catch (e) {
            console.error('[ACP:parse]', line.substring(0, 200), e.message);
          }
        }
      });

      setTimeout(() => resolve(), 500);
    });
  }

  handleMessage(msg) {
    if (msg.method) {
      this.handleIncoming(msg);
      return;
    }
    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const req = this.pendingRequests.get(msg.id);
      this.pendingRequests.delete(msg.id);
      clearTimeout(req.timeoutId);
      if (msg.error) {
        req.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      } else {
        req.resolve(msg.result);
      }
    }
  }

  handleIncoming(msg) {
    if (msg.method === 'session/update' && msg.params) {
      if (this.onUpdate) this.onUpdate(msg.params);
      this.resetPromptTimeout();
      return;
    }
    if (msg.method === 'session/request_permission' && msg.id !== undefined) {
      this.sendResponse(msg.id, { outcome: { outcome: 'selected', optionId: 'allow' } });
      this.resetPromptTimeout();
      return;
    }
    if (msg.method === 'fs/read_text_file' && msg.id !== undefined) {
      const filePath = msg.params?.path;
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        this.sendResponse(msg.id, { content });
      } catch (e) {
        this.sendError(msg.id, -32000, e.message);
      }
      return;
    }
    if (msg.method === 'fs/write_text_file' && msg.id !== undefined) {
      const { path: filePath, content } = msg.params || {};
      try {
        fs.writeFileSync(filePath, content, 'utf-8');
        this.sendResponse(msg.id, null);
      } catch (e) {
        this.sendError(msg.id, -32000, e.message);
      }
      return;
    }
  }

  resetPromptTimeout() {
    for (const [id, req] of this.pendingRequests) {
      if (req.method === 'session/prompt') {
        clearTimeout(req.timeoutId);
        req.timeoutId = setTimeout(() => {
          this.pendingRequests.delete(id);
          req.reject(new Error('session/prompt timeout'));
        }, 300000);
      }
    }
  }

  sendRequest(method, params, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      if (!this.child) { reject(new Error('ACP not connected')); return; }
      const id = this.nextRequestId++;
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`${method} timeout (${timeoutMs}ms)`));
      }, timeoutMs);
      this.pendingRequests.set(id, { resolve, reject, timeoutId, method });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params && { params }) }) + '\n');
    });
  }

  sendResponse(id, result) {
    if (!this.child) return;
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  }

  sendError(id, code, message) {
    if (!this.child) return;
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
  }

  async initialize() {
    if (this.printMode) return {};
    return this.sendRequest('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    });
  }

  async newSession(cwd) {
    if (this.printMode) {
      this.cwd = cwd;
      this.sessionId = 'print-' + Date.now();
      return { sessionId: this.sessionId };
    }
    const result = await this.sendRequest('session/new', { cwd, mcpServers: [] }, 120000);
    this.sessionId = result.sessionId;
    return result;
  }

  async setSessionMode(modeId) {
    if (this.printMode) return {};
    return this.sendRequest('session/set_mode', { sessionId: this.sessionId, modeId });
  }

  async injectSkills() {
    if (this.printMode) return {};
    const skillDescriptions = {
      'html_rendering': {
        name: 'HTML Rendering',
        description: 'Render styled HTML blocks directly in the chat interface',
        capability: 'The HTML will render as a styled block in the conversation.'
      },
      'image_display': {
        name: 'Image Display',
        description: 'Display images from the filesystem in styled blocks',
        capability: 'Supported formats: PNG, JPEG, GIF, WebP, SVG.'
      },
      'scrot': {
        name: 'Screenshot Utility',
        description: 'Capture screenshots of the desktop or specific windows',
        capability: 'Use scrot command-line tool to capture and save images to filesystem'
      },
      'fs_access': {
        name: 'Filesystem Access',
        description: 'Read and write files, browse directories',
        capability: 'Full read/write access to user home directory and workspace'
      }
    };

    const skillNames = Object.values(skillDescriptions).map(s => s.name).join(', ');
    const prompt = [{
      type: 'text',
      text: `RESPOND WITH RICH HTML USING RIPPLEUI COMPONENTS.\n\n${RIPPLEUI_SYSTEM_PROMPT}\n\nAvailable skills: ${skillNames}`
    }];

    return this.sendRequest('session/skill_inject', {
      sessionId: this.sessionId,
      skills: Object.values(skillDescriptions),
      notification: prompt
    }).catch(() => null);
  }

  async sendPrompt(prompt) {
    if (this.printMode) return this._sendPrintPrompt(prompt);
    const promptContent = Array.isArray(prompt) ? prompt : [{ type: 'text', text: prompt }];
    return this.sendRequest('session/prompt', { sessionId: this.sessionId, prompt: promptContent }, 300000);
  }

  _sendPrintPrompt(prompt) {
    const text = typeof prompt === 'string' ? prompt : (Array.isArray(prompt) ? prompt.map(p => p.text || '').join('\n') : String(prompt));

    return new Promise((resolve, reject) => {
      const args = [
        '-p',
        '--output-format', 'stream-json',
        '--verbose',
        '--model', 'sonnet',
        '--dangerously-skip-permissions',
        '--no-session-persistence',
        '--append-system-prompt', RIPPLEUI_SYSTEM_PROMPT,
        text
      ];

      const env = { ...process.env };
      delete env.NODE_OPTIONS;
      delete env.NODE_INSPECT;
      delete env.NODE_DEBUG;

      const child = spawn(CLAUDE_BIN, args, {
        cwd: this.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env
      });

      let buffer = '';
      let fullText = '';
      let resultData = null;

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', data => {
        buffer += data;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            this._handleStreamJson(parsed, t => { fullText += t; });
            if (parsed.type === 'result') resultData = parsed;
          } catch (_) {}
        }
      });

      child.stderr.on('data', d => {
        console.error('[claude-print:stderr]', d.toString().trim());
      });

      child.on('error', err => {
        reject(new Error(`claude --print spawn error: ${err.message}`));
      });

      child.on('close', code => {
        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer);
            this._handleStreamJson(parsed, t => { fullText += t; });
            if (parsed.type === 'result') resultData = parsed;
          } catch (_) {}
        }

        if (code !== 0 && !fullText) {
          reject(new Error(`claude --print exited with code ${code}`));
          return;
        }

        resolve({
          stopReason: resultData?.subtype || 'end_turn',
          result: resultData?.result || fullText
        });
      });

      child.stdin.end();
    });
  }

  _handleStreamJson(parsed, appendText) {
    if (parsed.type === 'assistant' && parsed.message?.content) {
      for (const block of parsed.message.content) {
        if (block.type === 'text' && block.text) {
          appendText(block.text);
          if (this.onUpdate) {
            this.onUpdate({
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { text: block.text }
              }
            });
          }
        }
      }
    }
    if (parsed.type === 'result' && parsed.result) {
      if (this.onUpdate) {
        this.onUpdate({
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { text: '' }
          }
        });
      }
    }
  }

  isRunning() {
    if (this.printMode) return true;
    return this.child && !this.child.killed;
  }

  async terminate() {
    if (this.printMode) { this.printMode = false; return; }
    if (!this.child) return;
    this.child.stdin.end();
    this.child.kill('SIGTERM');
    await new Promise(r => { this.child?.on('exit', r); setTimeout(r, 5000); });
    this.child = null;
  }
}
