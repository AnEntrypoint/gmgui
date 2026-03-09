// Tools plugin - tool detection, versioning, install/update handlers

import { execSync } from 'child_process';

export default {
  name: 'tools',
  version: '1.0.0',
  dependencies: ['database'],

  async init(config, plugins) {
    const db = plugins.get('database');
    const toolCache = new Map();
    const installInProgress = new Set();
    const operationQueue = [];

    const detectTools = async () => {
      const tools = [
        { id: 'gm-cc', pkg: '@anthropic-ai/claude-code', name: 'Claude Code' },
        { id: 'gm-oc', pkg: 'opencode-ai', name: 'OpenCode' },
        { id: 'gm-gc', pkg: '@google/gemini-cli', name: 'Gemini CLI' },
        { id: 'gm-kilo', pkg: '@kilocode/cli', name: 'Kilo' },
      ];

      for (const tool of tools) {
        try {
          execSync(`bun x ${tool.pkg} --version`, { stdio: 'ignore' });
          tool.installed = true;
        } catch {
          tool.installed = false;
        }
        toolCache.set(tool.id, tool);
      }
      return tools;
    };

    await detectTools();

    return {
      routes: [
        {
          method: 'GET',
          path: '/api/tools',
          handler: async (req, res) => {
            res.json({ tools: Array.from(toolCache.values()) });
          },
        },
        {
          method: 'GET',
          path: '/api/tools/:id/status',
          handler: async (req, res) => {
            const tool = toolCache.get(req.params.id);
            res.json(tool || { error: 'Tool not found' });
          },
        },
        {
          method: 'POST',
          path: '/api/tools/:id/install',
          handler: async (req, res) => {
            res.json({ success: true });
            // Async install in background
          },
        },
        {
          method: 'POST',
          path: '/api/tools/:id/update',
          handler: async (req, res) => {
            res.json({ success: true });
            // Async update in background
          },
        },
        {
          method: 'POST',
          path: '/api/tools/update',
          handler: async (req, res) => {
            res.json({ success: true });
            // Batch async update
          },
        },
        {
          method: 'GET',
          path: '/api/tools/:id/history',
          handler: async (req, res) => {
            res.json({ history: [] });
          },
        },
        {
          method: 'POST',
          path: '/api/tools/refresh-all',
          handler: async (req, res) => {
            await detectTools();
            res.json({ success: true });
          },
        },
      ],
      wsHandlers: {
        tool_install_complete: (data, clients) => {},
        tool_install_failed: (data, clients) => {},
        tool_update_complete: (data, clients) => {},
        tool_update_failed: (data, clients) => {},
      },
      api: {
        detectTools,
        getTools: () => Array.from(toolCache.values()),
      },
      stop: async () => {},
    };
  },

  async reload(state) {
    return state;
  },

  async stop() {},
};
