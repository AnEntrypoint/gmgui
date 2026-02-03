import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Common paths where claude-code-acp might be installed
const CLAUDE_CODE_ACP_PATHS = [
  '/config/.gmweb/npm-global/bin/claude-code-acp',
  '/usr/local/bin/claude-code-acp',
  '/usr/bin/claude-code-acp',
  path.join(os.homedir(), '.local/bin/claude-code-acp'),
  path.join(os.homedir(), '.gmweb/npm-global/bin/claude-code-acp'),
  'claude-code-acp', // fallback to PATH
];

// Common paths where opencode might be installed
const OPENCODE_PATHS = [
  '/usr/local/bin/opencode',
  '/usr/bin/opencode',
  path.join(os.homedir(), '.local/bin/opencode'),
  'opencode', // fallback to PATH
];

function findBinary(paths) {
  for (const p of paths) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch (_) {
      continue;
    }
  }
  return null;
}

const RIPPLEUI_SYSTEM_PROMPT = `CRITICAL: ALWAYS respond with styled HTML using RippleUI components. This is a web-based chat interface that ONLY renders HTML beautifully. NEVER respond with plain text.

FOR EVERY RESPONSE:
1. Wrap your ENTIRE response in a container div with proper styling
2. Use semantic HTML (h1-h6 for headings, p for paragraphs, ul/ol for lists)
3. Format code in <pre><code> blocks with language class
4. Use cards for organized information blocks
5. Use alerts for important information
6. Use tables for tabular data
7. Style everything with Tailwind CSS classes

RESPONSE STRUCTURE TEMPLATE:
\`\`\`html
<div class="space-y-4 p-4">
  <h2 class="text-2xl font-bold">Main Heading</h2>
  <p class="text-gray-700">Introductory text here.</p>
  
  <div class="card bg-base-100 shadow-lg p-4">
    <h3 class="text-lg font-semibold mb-2">Section Title</h3>
    <p>Content goes here.</p>
  </div>
  
  <pre class="bg-base-200 p-4 rounded-lg overflow-x-auto"><code class="language-javascript">// Code example
const example = () => { };</code></pre>
  
  <ul class="list-none space-y-2 ml-4">
    <li class="p-2 bg-base-200 rounded">• Item one</li>
    <li class="p-2 bg-base-200 rounded">• Item two</li>
  </ul>
</div>
\`\`\`

COMPONENT REFERENCE:
- Cards: <div class="card bg-base-100 shadow-lg p-6"><h3 class="font-bold">Title</h3><p>Content</p></div>
- Alerts: <div class="alert alert-info"><span>Message</span></div>
- Tables: <table class="table table-zebra"><thead><tr><th>Header</th></tr></thead><tbody><tr><td>Data</td></tr></tbody></table>
- Badges: <span class="badge badge-primary">Label</span>
- Code: <pre class="bg-base-200 p-4 rounded-lg overflow-x-auto"><code class="language-{lang}">{code}</code></pre>
- Lists: <ul class="list-none space-y-2"><li class="p-2 bg-base-200 rounded">Item</li></ul>

REQUIRED FOR ALL RESPONSES:
✓ Wrap response in HTML (usually a div with space-y-4 for vertical spacing)
✓ Use Tailwind classes: text-xl, font-bold, p-4, mb-3, rounded-lg, shadow, etc.
✓ Always use proper semantic HTML tags
✓ Format code blocks with language class for syntax highlighting
✓ Use colors: bg-blue-50, text-gray-700, border-blue-200 for visual hierarchy
✓ NEVER respond with raw text - ALWAYS wrap in HTML container

EXAMPLES OF GOOD RESPONSES:
- Questions: Wrap answer in a card with bold question and styled answer
- Code: Use <pre><code> with language class
- Lists: Use <ul> or <ol> with proper styling
- Instructions: Use numbered or bulleted lists in cards
- Explanations: Use cards for each concept, bold headings, clear spacing

Remember: The user sees raw HTML output. Make it beautiful and readable.`;

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

    const acpSetup = async () => {
      await this._spawnACP(agentType, cwd);
      await this.sendRequest('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      }, 10000);
      const result = await this.sendRequest('session/new', { cwd, mcpServers: [] }, 30000);
      this.sessionId = result.sessionId;
      await this.sendRequest('session/set_mode', { sessionId: this.sessionId, modeId: 'bypassPermissions' }, 10000);
    };

    const deadline = new Promise((_, reject) => setTimeout(() => reject(new Error('ACP handshake timeout (60s)')), 60000));

    try {
      await Promise.race([acpSetup(), deadline]);
      console.log(`[ACP] Connected via ACP bridge (${agentType})`);
    } catch (acpErr) {
      console.log(`[ACP] Bridge failed: ${acpErr.message}`);
      console.log(`[ACP] Falling back to claude --print mode`);
      this.printMode = true;
      this.sessionId = 'print-' + Date.now();
      if (this.child) {
        try { this.child.kill('SIGTERM'); } catch (_) {}
        this.child = null;
      }
      for (const [id, req] of this.pendingRequests) {
        clearTimeout(req.timeoutId);
      }
      this.pendingRequests.clear();
    }
  }

  _spawnACP(agentType, cwd) {
    return new Promise((resolve, reject) => {
      const env = { ...process.env };
      delete env.NODE_OPTIONS;
      delete env.NODE_INSPECT;
      delete env.NODE_DEBUG;

      // Ensure npm global bin directories are in PATH
      const npmGlobalBins = [
        '/config/.gmweb/npm-global/bin',
        path.join(os.homedir(), '.gmweb/npm-global/bin'),
        path.join(os.homedir(), '.local/bin'),
        '/usr/local/bin',
      ];
      const currentPath = env.PATH || '';
      const newPathEntries = npmGlobalBins.filter(p => !currentPath.includes(p));
      if (newPathEntries.length > 0) {
        env.PATH = [...newPathEntries, currentPath].join(':');
      }

      try {
        let cmd;
        let args;
        if (agentType === 'opencode') {
          cmd = findBinary(OPENCODE_PATHS);
          args = ['acp'];
        } else {
          cmd = findBinary(CLAUDE_CODE_ACP_PATHS);
          args = [];
        }

        if (!cmd) {
          reject(new Error(`Could not find ${agentType} ACP binary. Please ensure ${agentType === 'opencode' ? 'opencode' : 'claude-code-acp'} is installed and in your PATH.`));
          return;
        }

        this.child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env, shell: false });
      } catch (err) {
        reject(new Error(`Failed to spawn ACP: ${err.message}`));
        return;
      }

      this.child.stderr.on('data', d => console.error(`[ACP:stderr]`, d.toString().trim()));
      this.child.on('error', err => reject(new Error(`ACP spawn error: ${err.message}`)));
      this.child.on('exit', () => {
        this.child = null;
        for (const [id, req] of this.pendingRequests) {
          req.reject(new Error('ACP process exited'));
          clearTimeout(req.timeoutId);
        }
        this.pendingRequests.clear();
      });

      this.child.stdout.setEncoding('utf8');
      this.child.stdout.on('data', data => {
        this.buffer += data;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try { this.handleMessage(JSON.parse(line)); }
          catch (e) { console.error('[ACP:parse]', line.substring(0, 200), e.message); }
        }
      });

      setTimeout(resolve, 300);
    });
  }

  handleMessage(msg) {
    if (msg.method) { this.handleIncoming(msg); return; }
    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const req = this.pendingRequests.get(msg.id);
      this.pendingRequests.delete(msg.id);
      clearTimeout(req.timeoutId);
      if (msg.error) req.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else req.resolve(msg.result);
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
      try { this.sendResponse(msg.id, { content: fs.readFileSync(msg.params?.path, 'utf-8') }); }
      catch (e) { this.sendError(msg.id, -32000, e.message); }
      return;
    }
    if (msg.method === 'fs/write_text_file' && msg.id !== undefined) {
      try { fs.writeFileSync(msg.params?.path, msg.params?.content, 'utf-8'); this.sendResponse(msg.id, null); }
      catch (e) { this.sendError(msg.id, -32000, e.message); }
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

  async injectSkills(additionalContext = '') {
    if (this.printMode) return {};
    
    // Combine the system prompt with any additional context
    const systemPrompt = additionalContext ? `${RIPPLEUI_SYSTEM_PROMPT}\n\n---\n\n${additionalContext}` : RIPPLEUI_SYSTEM_PROMPT;
    
    try {
      const result = await this.sendRequest('session/skill_inject', {
        sessionId: this.sessionId,
        skills: [],
        notification: [{ type: 'text', text: systemPrompt }]
      });
      return result;
    } catch (e) {
      // skill_inject may not be supported, try alternative methods
      console.log(`[ACP] skill_inject failed (may not be supported): ${e.message}`);
      return null;
    }
  }

  /**
   * Inject system prompt as initial context
   */
  async injectSystemContext() {
    if (this.printMode) return {};
    
    // Some versions may need the system prompt sent as the first message context
    try {
      await this.sendRequest('session/context', {
        sessionId: this.sessionId,
        context: RIPPLEUI_SYSTEM_PROMPT,
        role: 'system'
      });
      return { success: true };
    } catch (e) {
      // This method may not be supported, silently fail
      return null;
    }
  }

  async sendPrompt(prompt) {
    if (this.printMode) return this._sendPrintPrompt(prompt);
    const promptContent = Array.isArray(prompt) ? prompt : [{ type: 'text', text: prompt }];
    return this.sendRequest('session/prompt', { sessionId: this.sessionId, prompt: promptContent }, 300000);
  }

  async _sendPrintPrompt(prompt) {
    throw new Error('Claude Code uses OAuth and requires the ACP bridge. The fallback to direct API calls is not supported because OAuth tokens cannot be used with the Anthropic API directly. Please ensure claude-code-acp is available in your PATH.');
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
