import { createClient } from 'claude-code-acp';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { default as SYSTEM_PROMPT } from './system-prompt.js';

/**
 * Load CLI configuration to ensure identical behavior
 * Supports both Claude Code and OpenCode
 */
function loadCLIConfig(agentType) {
  const configPaths = [
    // Claude Code paths
    path.join(os.homedir(), '.claude', 'config.json'),
    path.join(os.homedir(), '.claude-code', 'config.json'),
    path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'claude', 'config.json'),
    // OpenCode paths
    path.join(os.homedir(), '.opencode', 'config.json'),
    path.join(os.homedir(), '.config', 'opencode', 'config.json'),
    path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'opencode', 'config.json')
  ];

  for (const configPath of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        console.log(`[ACP] Loaded ${agentType} CLI config from ${configPath}`);
        return config;
      }
    } catch (e) {
      // Config file doesn't exist or is invalid, continue
    }
  }

  console.log(`[ACP] No ${agentType} config found, using defaults`);
  return {};
}

export default class ACPConnection {
  constructor() {
    this.client = null;
    this.sessionId = null;
    this.onUpdate = null;
  }

  /**
   * Connect to ACP bridge and create session
   * Uses identical configuration to CLI version
   */
  async connect(agentType, cwd) {
    try {
      console.log(`[ACP] Connecting to ${agentType}...`);

      // Load CLI configuration for identical behavior
      const cliConfig = loadCLIConfig(agentType);

      // Create client with CLI-identical configuration
      // Pass through all environment for OAuth and plugin support
      const clientConfig = {
        agent: agentType === 'opencode' ? 'opencode' : 'claude-code',
        cwd,
        // Use same environment as CLI (HOME, PATH, etc.)
        env: process.env,
        // Load plugins just like CLI does
        plugins: true,
        // Use OAuth for authentication (same as CLI)
        oauth: true,
        // Use model preferences from CLI config
        modelPreferences: cliConfig.modelPreferences || undefined,
        // Enable all capabilities that CLI enables
        capabilities: {
          fs: true,
          mcp: true,
          web: true,
          terminal: true
        },
        // Pass through any other CLI settings
        ...cliConfig
      };

      // Remove potential conflicting fields
      delete clientConfig.agent; // Re-add below
      delete clientConfig.cwd;   // Re-add below

      this.client = await createClient({
        agent: clientConfig.agent || (agentType === 'opencode' ? 'opencode' : 'claude-code'),
        cwd,
        ...clientConfig
      });

      console.log(`[ACP] ✅ Connected to ${agentType} (CLI-identical mode)`);
    } catch (err) {
      console.error(`[ACP] ❌ FATAL: Connection failed: ${err.message}`);
      throw new Error(`ACP connection failed for ${agentType}: ${err.message}`);
    }
  }

  /**
   * Initialize ACP session
   */
  async initialize() {
    if (!this.client) throw new Error('ACP not connected');
    return this.client.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } }
    });
  }

  /**
   * Create new session
   */
  async newSession(cwd) {
    if (!this.client) throw new Error('ACP not connected');
    const result = await this.client.request('session/new', { cwd, mcpServers: [] });
    this.sessionId = result.sessionId;
    return result;
  }

  /**
   * Set session mode
   */
  async setSessionMode(modeId) {
    if (!this.client) throw new Error('ACP not connected');
    return this.client.request('session/set_mode', { sessionId: this.sessionId, modeId });
  }

  /**
   * Inject unified HTML enforcement system prompt
   */
  async injectSkills(additionalContext = '') {
    if (!this.client) throw new Error('ACP not connected');

    const systemPrompt = additionalContext
      ? `${SYSTEM_PROMPT}\n\n---\n\n${additionalContext}`
      : SYSTEM_PROMPT;

    return this.client.request('session/skill_inject', {
      sessionId: this.sessionId,
      skills: [],
      notification: [{ type: 'text', text: systemPrompt }]
    });
  }

  /**
   * Inject system context with unified HTML enforcement
   */
  async injectSystemContext() {
    if (!this.client) throw new Error('ACP not connected');

    return this.client.request('session/context', {
      sessionId: this.sessionId,
      context: SYSTEM_PROMPT,
      role: 'system'
    });
  }

  /**
   * Send prompt and stream updates
   */
  async sendPrompt(prompt) {
    if (!this.client) throw new Error('ACP not connected');

    const promptContent = Array.isArray(prompt) ? prompt : [{ type: 'text', text: prompt }];

    // Setup update handler before sending
    if (this.onUpdate) {
      this.client.on('update', (update) => {
        // Forward updates immediately with no delay
        this.onUpdate({ update });
      });
    }

    // Send prompt and get result
    return this.client.request('session/prompt', {
      sessionId: this.sessionId,
      prompt: promptContent
    }, 300000);
  }

  /**
   * Check if connection is running
   */
  isRunning() {
    return this.client !== null;
  }

  /**
   * Terminate connection
   */
  async terminate() {
    if (!this.client) return;

    try {
      await this.client.close();
    } catch (err) {
      console.error(`[ACP] Error during terminate: ${err.message}`);
    } finally {
      this.client = null;
      this.sessionId = null;
    }
  }
}
