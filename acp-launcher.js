import CLILauncher from './claude-cli-launcher.js';

/**
 * ACPConnection - Wraps CLILauncher with ACP interface
 *
 * This maintains backward compatibility with the existing server code
 * while using the real Claude CLI tool underneath.
 */
export default class ACPConnection {
  constructor() {
    this.sessionId = null;
    this.onUpdate = null;
    this.launcher = new CLILauncher();
  }

  async connect(agentType, cwd) {
    console.log(`[ACP] Using real Claude CLI (${agentType})`);
    return this.launcher.connect(agentType, cwd);
  }

  async initialize() {
    return this.launcher.initialize();
  }

  async newSession(cwd) {
    this.sessionId = Math.random().toString(36).substring(7);
    return this.launcher.newSession(cwd);
  }

  async setSessionMode(modeId) {
    return this.launcher.setSessionMode(modeId);
  }

  async injectSkills(additionalContext = '') {
    return this.launcher.injectSkills();
  }

  async injectSystemContext() {
    return this.launcher.injectSystemContext();
  }

  async sendPrompt(prompt) {
    // Forward the onUpdate handler
    this.launcher.onUpdate = this.onUpdate;

    try {
      const result = await this.launcher.sendPrompt(prompt);
      return result;
    } catch (err) {
      console.error(`[ACP] Query error: ${err.message}`);
      throw err;
    }
  }

  isRunning() {
    return this.launcher.isRunning();
  }

  async terminate() {
    return this.launcher.terminate();
  }
}
