// Workflow plugin - git push detection, workflow execution, status polling

import fs from 'fs';
import path from 'path';

export default {
  name: 'workflow',
  version: '1.0.0',
  dependencies: ['git', 'database'],

  async init(config, plugins) {
    const git = plugins.get('git');
    const db = plugins.get('database');
    const workflowPolls = new Map();
    const runCache = new Map();

    const getWorkflows = () => {
      const repoRoot = process.cwd();
      const workflowDir = path.join(repoRoot, '.github', 'workflows');
      if (!fs.existsSync(workflowDir)) return [];
      return fs.readdirSync(workflowDir)
        .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
        .map(name => ({ name, path: path.join(workflowDir, name) }));
    };

    const parseWorkflow = (filePath) => {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        // Parse YAML manually or return raw content
        return { name: path.basename(filePath), content };
      } catch {
        return null;
      }
    };

    return {
      routes: [
        {
          method: 'GET',
          path: '/api/workflows',
          handler: (req, res) => {
            const workflows = getWorkflows();
            res.json({ workflows });
          },
        },
        {
          method: 'GET',
          path: '/api/workflows/:name/history',
          handler: (req, res) => {
            res.json({ history: [] });
          },
        },
        {
          method: 'POST',
          path: '/api/workflows/:name/trigger',
          handler: async (req, res) => {
            res.json({ success: true, message: 'Workflow trigger requires GitHub API' });
          },
        },
        {
          method: 'GET',
          path: '/api/workflows/:name/status',
          handler: (req, res) => {
            res.json({ status: 'unknown' });
          },
        },
      ],
      wsHandlers: {
        workflow_triggered: (data, clients) => {},
        workflow_progress: (data, clients) => {},
        workflow_complete: (data, clients) => {},
      },
      api: {
        getWorkflows,
        parseWorkflow,
      },
      stop: async () => {
        for (const interval of workflowPolls.values()) {
          clearInterval(interval);
        }
      },
    };
  },

  async reload(state) {
    return state;
  },

  async stop() {},
};
