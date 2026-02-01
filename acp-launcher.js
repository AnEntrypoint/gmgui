import { spawn } from 'child_process';
import fs from 'fs';

export default class ACPConnection {
  constructor() {
    this.child = null;
    this.buffer = '';
    this.nextRequestId = 1;
    this.pendingRequests = new Map();
    this.sessionId = null;
    this.onUpdate = null;
  }

  async connect(agentType, cwd) {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    delete env.NODE_INSPECT;
    delete env.NODE_DEBUG;

    if (agentType === 'opencode') {
      this.child = spawn('opencode', ['acp'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env, shell: false });
    } else {
      this.child = spawn('claude-code-acp', [], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env, shell: false });
    }

    this.child.stderr.on('data', d => console.error(`[ACP:${agentType}:stderr]`, d.toString().trim()));
    this.child.on('error', err => console.error(`[ACP:${agentType}:error]`, err.message));
    this.child.on('exit', (code, signal) => {
      console.log(`[ACP:${agentType}] exited code=${code} signal=${signal}`);
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
        try {
          this.handleMessage(JSON.parse(line));
        } catch (e) {
          console.error('[ACP:parse]', line.substring(0, 200), e.message);
        }
      }
    });

    await new Promise(r => setTimeout(r, 500));
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

  async injectSkills(skills) {
    const skillDescriptions = {
      'html_rendering': {
        name: 'HTML Rendering',
        description: 'Render styled HTML blocks directly in the chat interface',
        capability: 'Send a sessionUpdate with this exact format:\n{\n  "sessionUpdate": "html_content",\n  "content": {\n    "html": "<div style=\\"padding:1rem; border:1px solid #ccc; border-radius:0.5rem; background:#f9f9f9\\">Your HTML content here</div>",\n    "title": "Optional title for the block",\n    "id": "optional-unique-id"\n  }\n}\nThe HTML will render as a styled square/box block in the conversation.'
      },
      'image_display': {
        name: 'Image Display',
        description: 'Display images from the filesystem in styled blocks',
        capability: 'Send a sessionUpdate with this exact format:\n{\n  "sessionUpdate": "image_content",\n  "content": {\n    "path": "/path/to/image.png",\n    "title": "Optional image title",\n    "alt": "Alt text for accessibility"\n  }\n}\nSupported formats: PNG, JPEG, GIF, WebP, SVG. The image will render in a styled block.'
      },
      'scrot': {
        name: 'Screenshot Utility',
        description: 'Capture screenshots of the desktop or specific windows',
        capability: 'Use scrot command-line tool to capture and save images to filesystem, then display using image_display skill'
      },
      'fs_access': {
        name: 'Filesystem Access',
        description: 'Read and write files, browse directories',
        capability: 'Full read/write access to user home directory and workspace'
      }
    };

    const skillsToInject = skills
      .map(s => skillDescriptions[s])
      .filter(Boolean);

    if (skillsToInject.length === 0) return;

    const prompt = [
      {
        type: 'text',
        text: `CRITICAL: HTML Rendering Requirements & Visual Communication Standards

YOU MUST RENDER YOUR RESPONSES AS HTML FOR ALL IMPACTFUL INFORMATION.

MANDATORY RULES:
1. ALWAYS use HTML rendering for responses - this is not optional
2. Every response must have visual HTML representation of key information
3. Text-only responses are forbidden unless explicitly unavoidable
4. Use HTML blocks to display:
   - Lists and tables of data
   - Analysis results and metrics
   - Code snippets and technical content
   - Status reports and progress
   - Hierarchical information and structures
   - Any data that benefits from visual formatting

VISUAL REPRESENTATION EXAMPLES:

For lists/data:
{"sessionUpdate": "html_content", "content": {"html": "<div style='padding:1rem;border:1px solid #e5e7eb;border-radius:0.5rem;background:#f9fafb'><h4 style='margin:0 0 0.5rem 0'>Items:</h4><ul style='margin:0;padding-left:1.5rem'><li>Item 1</li><li>Item 2</li></ul></div>", "title": "List of Results"}}

For metrics/status:
{"sessionUpdate": "html_content", "content": {"html": "<div style='padding:1rem;border:1px solid #e5e7eb;border-radius:0.5rem;background:#f9fafb'><div style='display:grid;grid-template-columns:1fr 1fr;gap:1rem'><div style='padding:0.5rem;background:#f0fdf4;border-radius:0.25rem'><div style='font-weight:bold'>Metric 1</div><div style='font-size:1.5em;color:#16a34a'>Value</div></div><div style='padding:0.5rem;background:#fef2f2;border-radius:0.25rem'><div style='font-weight:bold'>Metric 2</div><div style='font-size:1.5em;color:#dc2626'>Value</div></div></div></div>", "title": "Status Report"}}

For code:
{"sessionUpdate": "html_content", "content": {"html": "<div style='padding:1rem;border:1px solid #e5e7eb;border-radius:0.5rem;background:#f9fafb'><pre style='margin:0;overflow:auto;background:#f3f4f6;padding:0.5rem;border-radius:0.25rem'><code>code content here</code></pre></div>", "title": "Code Example"}}

STYLING GUIDELINES:
When rendering HTML, ALWAYS use RippleUI CSS classes for styling and compatibility:
- Use RippleUI color classes: bg-primary, bg-secondary, text-primary, text-secondary, border-color
- Use RippleUI utility classes: p-*, m-*, gap-*, rounded-*
- Use RippleUI component classes: btn, card, badge, etc.
- Use inline styles ONLY for dynamic colors or values

PREFERRED: RippleUI compatible HTML
{"sessionUpdate": "html_content", "content": {"html": "<div class='bg-secondary border-color rounded-lg p-6'><h3 class='text-primary'>Title</h3><p class='text-secondary'>Content</p></div>"}}

FALLBACK: Inline styles only (when RippleUI unavailable)
{"sessionUpdate": "html_content", "content": {"html": "<div style='background:#f9fafb;border:1px solid #e5e7eb;padding:24px;border-radius:8px'><h3>Title</h3><p>Content</p></div>"}}

REMEMBER: RippleUI CSS file is already loaded in the page.

MULTI-BLOCK RESPONSES:
You can send multiple HTML blocks in a single response:
1. Send text explanation via agent_message_chunk
2. Send HTML visualization via html_content (multiple times if needed)
3. Combine text and visuals for maximum impact

IMAGE DISPLAY:
When appropriate, capture or generate visual content:
{"sessionUpdate": "image_content", "content": {"path": "/path/to/image.png", "title": "Visual content"}}

Available skills: ${skillsToInject.map(s => s.name).join(', ')}`
      }
    ];

    return this.sendRequest('session/skill_inject', {
      sessionId: this.sessionId,
      skills: skillsToInject,
      notification: prompt
    }).catch(() => null);
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
