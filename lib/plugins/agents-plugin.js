// Agents plugin - agent discovery, runner spawning, process management

import path from 'path';
import { runClaudeWithStreaming } from '../claude-runner.js';

export default {
  name: 'agents',
  version: '1.0.0',
  dependencies: ['database', 'stream'],

  async init(config, plugins) {
    const db = plugins.get('database');
    const stream = plugins.get('stream');
    const discoveredAgents = new Map();
    const activeExecutions = new Map();

    // Discover agents on startup
    const discoverAgents = async () => {
      const agents = [
        { id: 'gm-cc', name: 'Claude Code', bin: 'claude', installed: true },
        { id: 'gm-oc', name: 'OpenCode', bin: 'opencode', installed: false },
        { id: 'gm-gc', name: 'Gemini CLI', bin: 'gemini', installed: false },
        { id: 'gm-kilo', name: 'Kilo', bin: 'kilo', installed: false },
      ];
      agents.forEach(a => discoveredAgents.set(a.id, a));
      return agents;
    };

    await discoverAgents();

    return {
      routes: [
        {
          method: 'GET',
          path: '/api/agents',
          handler: (req, res) => {
            res.json({ agents: Array.from(discoveredAgents.values()) });
          },
        },
        {
          method: 'POST',
          path: '/api/conversations/:id/stream',
          handler: async (req, res) => {
            const { id } = req.params;
            const { agentId, message } = req.body;

            try {
              const agent = discoveredAgents.get(agentId);
              if (!agent) return res.status(404).json({ error: 'Agent not found' });

              const session = stream.api.createSession(id);
              // Use runClaudeWithStreaming instead
              activeExecutions.set(id, { sessionId: session.id });

              res.json({ sessionId: session.id, pid: proc.pid });
            } catch (e) {
              res.status(500).json({ error: e.message });
            }
          },
        },
      ],
      wsHandlers: {},
      api: {
        getAgents: () => Array.from(discoveredAgents.values()),
        discoverAgents,
      },
      stop: async () => {
        for (const proc of activeExecutions.values()) {
          if (proc && !proc.killed) proc.kill();
        }
      },
    };
  },

  async reload(state) {
    return state;
  },

  async stop() {},
};
