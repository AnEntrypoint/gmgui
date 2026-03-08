// Files plugin - file browser, upload handler, drag-drop support

import path from 'path';
import fs from 'fs';

export default {
  name: 'files',
  version: '1.0.0',
  dependencies: ['database'],

  async init(config, plugins) {
    const db = plugins.get('database');
    const uploadedFiles = new Map();

    const browseDirectory = (dir) => {
      try {
        const entries = fs.readdirSync(dir);
        return entries.map(entry => {
          const fullPath = path.join(dir, entry);
          const stat = fs.statSync(fullPath);
          return {
            name: entry,
            path: fullPath,
            isDirectory: stat.isDirectory(),
            size: stat.size,
          };
        });
      } catch (e) {
        return [];
      }
    };

    return {
      routes: [
        {
          method: 'GET',
          path: '/files/:conversationId',
          handler: (req, res) => {
            const { conversationId } = req.params;
            const { dir } = req.query;
            const entries = browseDirectory(dir || process.cwd());
            res.json({ entries, currentDir: dir || process.cwd() });
          },
        },
        {
          method: 'POST',
          path: '/api/upload/:conversationId',
          handler: async (req, res) => {
            const { conversationId } = req.params;
            uploadedFiles.set(conversationId, Date.now());
            res.json({ success: true, conversationId });
          },
        },
        {
          method: 'POST',
          path: '/api/folders',
          handler: async (req, res) => {
            const { path: folderPath } = req.body;
            try {
              fs.mkdirSync(folderPath, { recursive: true });
              res.json({ success: true, path: folderPath });
            } catch (e) {
              res.status(400).json({ error: e.message });
            }
          },
        },
      ],
      wsHandlers: {},
      api: {
        browseDirectory,
      },
      stop: async () => {
        uploadedFiles.clear();
      },
    };
  },

  async reload(state) {
    return state;
  },

  async stop() {},
};
