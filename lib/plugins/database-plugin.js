// Database plugin - SQLite init, schema, checkpoint recovery

import * as dbModule from '../database.js';

export default {
  name: 'database',
  version: '1.0.0',
  dependencies: [],

  async init(config, plugins) {
    // Initialize database schema
    if (dbModule.initializeSchema) dbModule.initializeSchema();

    // Return API for other plugins
    return {
      routes: [],
      wsHandlers: {},
      api: {
        // Query functions from database.js
        queries: dbModule.queries || {},

        // Checkpoint/recovery
        checkpoint: (label) => {
          console.log(`[Database] Checkpoint: ${label}`);
        },

        recover: async (label) => {
          console.log(`[Database] Recover from: ${label}`);
        },

        // Direct DB access
        db: dbModule.dataDir,
      },
      stop: async () => {},
    };
  },

  async reload(state) {
    return state;
  },

  async stop() {},
};
