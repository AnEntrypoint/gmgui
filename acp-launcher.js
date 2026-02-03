import { query } from '@anthropic-ai/claude-code';
import { default as SYSTEM_PROMPT } from './system-prompt.js';

export default class ACPConnection {
  constructor() {
    this.sessionId = null;
    this.onUpdate = null;
  }

  async connect(agentType, cwd) {
    console.log(`[ACP] Using Claude Code SDK (${agentType})`);
  }

  async initialize() {
    return { ready: true };
  }

  async newSession(cwd) {
    this.sessionId = Math.random().toString(36).substring(7);
    return { sessionId: this.sessionId };
  }

  async setSessionMode(modeId) {
    return { modeId };
  }

  async injectSkills(additionalContext = '') {
    return { skills: [] };
  }

  async injectSystemContext() {
    return { context: SYSTEM_PROMPT };
  }

  async sendPrompt(prompt) {
    let fullResponse = '';

    try {
      const promptText = typeof prompt === 'string' ? prompt : prompt.map(p => p.text).join('\n');
      const systemMessage = `${SYSTEM_PROMPT}\n\nUser Request: ${promptText}`;

      const response = await query({
        prompt: systemMessage,
        options: {}
      });

      // Handle different response formats
      let responseText = '';
      if (typeof response === 'string') {
        responseText = response;
      } else if (response?.content) {
        responseText = typeof response.content === 'string' ? response.content : response.content.map(c => c.text || '').join('');
      } else if (response?.result) {
        responseText = response.result;
      } else if (response?.text) {
        responseText = response.text;
      } else {
        responseText = String(response || '');
      }

      fullResponse = responseText;

      // Emit updates for streaming
      if (this.onUpdate && responseText) {
        this.onUpdate({
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { text: responseText }
          }
        });
      }

      return { content: fullResponse };
    } catch (err) {
      console.error(`[ACP] Query error: ${err.message}`);
      throw err;
    }
  }

  isRunning() {
    return true;
  }

  async terminate() {
    return;
  }
}
