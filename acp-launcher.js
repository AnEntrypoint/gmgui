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

const RIPPLEUI_SYSTEM_PROMPT = `CRITICAL INSTRUCTION: You are responding in a web-based HTML interface. EVERY response must be formatted as beautiful, styled HTML using RippleUI and Tailwind CSS. This is NOT a text-based interface - users see raw HTML rendered in their browser.

YOUR RESPONSE FORMAT MUST BE:
Wrap your ENTIRE response in a single HTML container with these elements:

\`\`\`html
<div class="space-y-4 p-6 max-w-4xl">
  <!-- Main content goes here -->
</div>
\`\`\`

STRUCTURE YOUR RESPONSES LIKE THIS:

For questions/answers:
\`\`\`html
<div class="space-y-4 p-6">
  <h2 class="text-2xl font-bold text-gray-900">Your Answer</h2>
  <div class="card bg-blue-50 border-l-4 border-blue-500 p-4">
    <p class="text-gray-700">Your detailed answer here</p>
  </div>
</div>
\`\`\`

For code:
\`\`\`html
<div class="space-y-4 p-6">
  <h3 class="text-xl font-bold">Code Example</h3>
  <pre class="bg-gray-900 text-white p-4 rounded-lg overflow-x-auto"><code>// Your code here
function example() { }</code></pre>
</div>
\`\`\`

For lists:
\`\`\`html
<div class="space-y-4 p-6">
  <h3 class="text-xl font-bold">Items</h3>
  <ul class="list-none space-y-2">
    <li class="p-3 bg-gray-100 rounded border-l-4 border-gray-400">• Item one</li>
    <li class="p-3 bg-gray-100 rounded border-l-4 border-gray-400">• Item two</li>
  </ul>
</div>
\`\`\`

COMPONENT LIBRARY:
- Card: <div class="card bg-white shadow-lg p-6 rounded-lg"><h4 class="font-bold">Title</h4><p>Content</p></div>
- Alert: <div class="alert bg-red-100 border-l-4 border-red-500 p-4"><span class="text-red-800">Warning message</span></div>
- Success: <div class="alert bg-green-100 border-l-4 border-green-500 p-4"><span class="text-green-800">Success</span></div>
- Table: <table class="w-full border-collapse border border-gray-300"><thead class="bg-gray-100"><tr><th class="p-2 text-left">Col</th></tr></thead><tbody><tr><td class="p-2 border border-gray-300">Data</td></tr></tbody></table>
- Badge: <span class="inline-block bg-blue-500 text-white px-3 py-1 rounded-full text-sm">Label</span>
- Code inline: <code class="bg-gray-200 px-2 py-1 rounded text-red-600 font-mono">code</code>

MANDATORY RULES:
✓ EVERY response MUST be wrapped in a div with class "space-y-4 p-6"
✓ Use semantic HTML: <h1>-<h6>, <p>, <ul>, <ol>, <table>, <pre>
✓ Always add Tailwind classes for styling: colors, padding, margins, rounded corners
✓ Code blocks MUST use <pre><code> with language class like \`class="language-javascript"\`
✓ NEVER send plain text without HTML wrapping
✓ NEVER respond outside of HTML container
✓ Use color classes: text-gray-700, bg-blue-50, border-blue-500
✓ Make visual hierarchy clear: use different font sizes, colors, cards

EXAMPLES OF COMPLETE RESPONSES:

Example 1 - Answer:
<div class="space-y-4 p-6"><h2 class="text-2xl font-bold">Explanation</h2><p class="text-gray-700">Here is the detailed explanation...</p></div>

Example 2 - Code:
<div class="space-y-4 p-6"><h3 class="text-xl font-bold">JavaScript Function</h3><pre class="bg-gray-900 text-white p-4 rounded overflow-x-auto"><code>const greet = () => console.log('Hello');</code></pre></div>

Example 3 - Multiple sections:
<div class="space-y-4 p-6"><h2 class="text-2xl font-bold">Topic</h2><div class="card bg-white shadow p-4"><h3 class="font-bold">Section 1</h3><p>Content here</p></div><div class="card bg-white shadow p-4"><h3 class="font-bold">Section 2</h3><p>More content</p></div></div>

YOU MUST ALWAYS OUTPUT VALID, COMPLETE HTML.
The user's interface shows YOUR HTML directly - make it beautiful, well-organized, and professional.`;

export default class ACPConnection {
  constructor() {
    this.child = null;
    this.buffer = '';
    this.nextRequestId = 1;
    this.pendingRequests = new Map();
    this.sessionId = null;
    this.onUpdate = null;
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
      console.error(`[ACP] ❌ FATAL: Bridge failed: ${acpErr.message}`);
      console.error(`[ACP] The ACP bridge is REQUIRED. Please install the bridge for ${agentType}.`);
      if (this.child) {
        try { this.child.kill('SIGTERM'); } catch (_) {}
        this.child = null;
      }
      throw acpErr;
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
    return this.sendRequest('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    });
  }

  async newSession(cwd) {
    const result = await this.sendRequest('session/new', { cwd, mcpServers: [] }, 120000);
    this.sessionId = result.sessionId;
    return result;
  }

  async setSessionMode(modeId) {
    return this.sendRequest('session/set_mode', { sessionId: this.sessionId, modeId });
  }

  async injectSkills(additionalContext = '') {
    // Combine the system prompt with any additional context
    const systemPrompt = additionalContext ? `${RIPPLEUI_SYSTEM_PROMPT}\n\n---\n\n${additionalContext}` : RIPPLEUI_SYSTEM_PROMPT;

    return this.sendRequest('session/skill_inject', {
      sessionId: this.sessionId,
      skills: [],
      notification: [{ type: 'text', text: systemPrompt }]
    });
  }

  /**
   * Inject system prompt as initial context
   */
  async injectSystemContext() {
    return this.sendRequest('session/context', {
      sessionId: this.sessionId,
      context: RIPPLEUI_SYSTEM_PROMPT,
      role: 'system'
    });
  }

  async sendPrompt(prompt) {
    const promptContent = Array.isArray(prompt) ? prompt : [{ type: 'text', text: prompt }];
    return this.sendRequest('session/prompt', { sessionId: this.sessionId, prompt: promptContent }, 300000);
  }

  isRunning() {
    return this.child && !this.child.killed;
  }

  async terminate() {
    if (!this.child) return;
    this.child.stdin.end();
    this.child.kill('SIGTERM');
    await new Promise(r => { this.child?.on('exit', r); setTimeout(r, 5000); });
    this.child = null;
  }
}
