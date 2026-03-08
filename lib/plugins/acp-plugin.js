// ACP plugin - OpenCode, Gemini, Kilo, Codex startup and health checks

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export default {
  name: 'acp',
  version: '1.0.0',
  dependencies: ['tools'],

  async init(config, plugins) {
    const tools = plugins.get('tools');
    const toolProcesses = new Map();
    const healthCheckIntervals = new Map();
    const restartCounts = new Map();
    const acpPorts = new Map();

    const toolSpecs = [
      { name: 'opencode', port: 18100, cmd: 'opencode acp --port 18100' },
      { name: 'gemini', port: 18101, cmd: 'gemini acp --port 18101' },
      { name: 'kilo', port: 18102, cmd: 'kilo acp --port 18102' },
      { name: 'codex', port: 18103, cmd: 'codex acp --port 18103' },
    ];

    const startTool = async (spec) => {
      try {
        const proc = spawn('bash', ['-c', spec.cmd]);
        toolProcesses.set(spec.name, proc);
        acpPorts.set(spec.name, spec.port);
        restartCounts.set(spec.name, 0);

        // Health check every 30s
        const interval = setInterval(() => {
          if (proc.killed) {
            clearInterval(interval);
            healthCheckIntervals.delete(spec.name);
          }
        }, 30000);
        healthCheckIntervals.set(spec.name, interval);
      } catch (e) {
        console.error(`[ACP] Failed to start ${spec.name}:`, e.message);
      }
    };

    // Start all ACP tools
    for (const spec of toolSpecs) {
      await startTool(spec);
    }

    return {
      routes: [
        {
          method: 'GET',
          path: '/api/acp/status',
          handler: (req, res) => {
            const status = {};
            for (const [name, proc] of toolProcesses) {
              status[name] = {
                running: !proc.killed,
                port: acpPorts.get(name),
                pid: proc.pid,
                restarts: restartCounts.get(name) || 0,
              };
            }
            res.json({ tools: status });
          },
        },
      ],
      wsHandlers: {},
      api: {
        getStatus: () => Object.fromEntries(acpPorts),
      },
      stop: async () => {
        for (const [name, interval] of healthCheckIntervals) {
          clearInterval(interval);
        }
        for (const [name, proc] of toolProcesses) {
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
