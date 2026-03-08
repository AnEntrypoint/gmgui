// Stream plugin - session management, streaming execution, rate limiting

import { v4 as uuidv4 } from 'uuid';

export default {
  name: 'stream',
  version: '1.0.0',
  dependencies: ['database'],

  async init(config, plugins) {
    const db = plugins.get('database');
    const activeSessions = new Map();
    const pendingMessages = new Map();
    const rateLimitState = new Map();
    const recoveryCheckpoints = new Map();

    return {
      routes: [
        {
          method: 'GET',
          path: '/api/sessions/:id',
          handler: async (req, res) => {
            const { id } = req.params;
            const session = activeSessions.get(id);
            if (!session) return res.status(404).json({ error: 'Session not found' });
            res.json(session);
          },
        },
        {
          method: 'GET',
          path: '/api/sessions/:id/chunks',
          handler: async (req, res) => {
            const { id } = req.params;
            const { since } = req.query;
            const chunks = db.queries.getStreamChunks(id, since ? parseInt(since) : 0);
            res.json({ chunks });
          },
        },
        {
          method: 'GET',
          path: '/api/sessions/:id/execution',
          handler: async (req, res) => {
            const { id } = req.params;
            const { limit, offset, filterType } = req.query;
            const events = db.queries.getExecutionEvents(id, parseInt(limit) || 100, parseInt(offset) || 0);
            res.json({ events });
          },
        },
        {
          method: 'GET',
          path: '/api/conversations/:id/sessions/latest',
          handler: async (req, res) => {
            const { id } = req.params;
            const sessions = Array.from(activeSessions.values()).filter(s => s.conversationId === id);
            const latest = sessions[sessions.length - 1];
            res.json(latest || { error: 'No sessions' });
          },
        },
      ],
      wsHandlers: {
        streaming_start: (data, clients) => {},
        streaming_progress: (data, clients) => {},
        streaming_complete: (data, clients) => {},
        streaming_error: (data, clients) => {},
        rate_limit_hit: (data, clients) => {},
      },
      api: {
        createSession: (conversationId) => {
          const session = { id: uuidv4(), conversationId, createdAt: Date.now() };
          activeSessions.set(session.id, session);
          return session;
        },
        getSession: (id) => activeSessions.get(id),
        closeSession: (id) => activeSessions.delete(id),
      },
      stop: async () => {
        activeSessions.clear();
        pendingMessages.clear();
      },
    };
  },

  async reload(state) {
    return state;
  },

  async stop() {},
};
