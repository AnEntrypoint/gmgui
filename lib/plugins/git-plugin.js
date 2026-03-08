// Git plugin - version control, workflow detection, push events

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

export default {
  name: 'git',
  version: '1.0.0',
  dependencies: [],

  async init(config, plugins) {
    let lastPushSha = null;
    let workflowsList = [];
    let pushInProgress = false;

    const getRepoRoot = () => {
      try {
        return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
      } catch {
        return process.cwd();
      }
    };

    const getStatus = async () => {
      try {
        const status = execSync('git status --short', { encoding: 'utf8' });
        const unpushed = execSync('git rev-list --count @{u}..HEAD', { encoding: 'utf8' }).trim();
        return { dirty: status.length > 0, unpushedCount: parseInt(unpushed) || 0 };
      } catch (e) {
        return { dirty: false, unpushedCount: 0 };
      }
    };

    const listWorkflows = () => {
      const root = getRepoRoot();
      const workflowDir = path.join(root, '.github', 'workflows');
      if (!fs.existsSync(workflowDir)) return [];
      return fs.readdirSync(workflowDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
    };

    const push = async (message) => {
      if (pushInProgress) throw new Error('Push already in progress');
      pushInProgress = true;
      try {
        execSync('git add -A');
        execSync(`git commit -m "${message}"`);
        const result = execSync('git push', { encoding: 'utf8' });
        lastPushSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
        return { success: true, sha: lastPushSha };
      } catch (error) {
        return { success: false, error: error.message };
      } finally {
        pushInProgress = false;
      }
    };

    workflowsList = listWorkflows();

    return {
      routes: [
        {
          method: 'GET',
          path: '/api/git/status',
          handler: async (req, res) => {
            const status = await getStatus();
            res.json({ ...status, workflows: workflowsList });
          },
        },
        {
          method: 'POST',
          path: '/api/git/push',
          handler: async (req, res) => {
            const { message } = req.body;
            try {
              const result = await push(message);
              res.json(result);
            } catch (e) {
              res.status(400).json({ error: e.message });
            }
          },
        },
        {
          method: 'GET',
          path: '/api/git/workflows',
          handler: (req, res) => {
            res.json({ workflows: workflowsList });
          },
        },
        {
          method: 'POST',
          path: '/api/git/workflow/:name/run',
          handler: (req, res) => {
            res.json({ status: 'not-implemented', message: 'Use GitHub Actions API' });
          },
        },
      ],
      wsHandlers: {
        git_status_changed: (data, clients) => {
          // Broadcast git status to all clients
        },
      },
      api: {
        getStatus,
        push,
        listWorkflows,
      },
      stop: async () => {},
    };
  },

  async reload(state) {
    return state;
  },

  async stop() {},
};
