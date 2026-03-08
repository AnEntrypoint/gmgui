// Auth plugin - OAuth2, provider config, agentauth integration

import http from 'http';

export default {
  name: 'auth',
  version: '1.0.0',
  dependencies: ['database'],

  async init(config, plugins) {
    const db = plugins.get('database');
    const providerConfigs = new Map();
    const oauthClients = new Map();
    const sessions = new Map();

    // Detect provider configs on startup
    const detectProviders = () => {
      const providers = [
        { id: 'anthropic', name: 'Anthropic', configured: false },
        { id: 'google', name: 'Google', configured: false },
        { id: 'github', name: 'GitHub', configured: false },
      ];
      providers.forEach(p => providerConfigs.set(p.id, p));
      return providers;
    };

    detectProviders();

    // Agentauth integration
    const agentauthStart = async (provider, scopes) => {
      return new Promise((resolve, reject) => {
        const options = {
          hostname: 'localhost',
          port: 8765,
          path: '/auth/start',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        };

        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error('Agentauth unavailable'));
            }
          });
        });

        req.on('error', () => reject(new Error('Agentauth service not running')));
        req.write(JSON.stringify({ provider, scopes }));
        req.end();
      });
    };

    return {
      routes: [
        {
          method: 'GET',
          path: '/api/auth/status',
          handler: (req, res) => {
            res.json({ authenticated: sessions.size > 0, sessions: Array.from(sessions.keys()) });
          },
        },
        {
          method: 'GET',
          path: '/api/auth/configs',
          handler: (req, res) => {
            const masked = Array.from(providerConfigs.values()).map(p => ({
              id: p.id,
              name: p.name,
              configured: p.configured,
            }));
            res.json({ providers: masked });
          },
        },
        {
          method: 'POST',
          path: '/api/auth/callback',
          handler: (req, res) => {
            const { code } = req.body;
            res.json({ success: true, code });
          },
        },
        {
          method: 'POST',
          path: '/api/auth/logout',
          handler: (req, res) => {
            sessions.clear();
            res.json({ success: true });
          },
        },
        {
          method: 'POST',
          path: '/api/auth/agentauth-start',
          handler: async (req, res) => {
            const { provider, scopes } = req.body;
            try {
              const result = await agentauthStart(provider, scopes);
              res.json(result);
            } catch (e) {
              res.status(503).json({ error: e.message });
            }
          },
        },
        {
          method: 'GET',
          path: '/api/auth/agentauth-status',
          handler: async (req, res) => {
            const { code } = req.query;
            res.json({ status: 'polling-not-implemented' });
          },
        },
      ],
      wsHandlers: {},
      api: {
        getProviders: () => Array.from(providerConfigs.values()),
      },
      stop: async () => {
        sessions.clear();
      },
    };
  },

  async reload(state) {
    return state;
  },

  async stop() {},
};
