// AgentGUI Server - Plugin architecture bootstrap
// Minimal core: HTTP server + plugin loader + hot reload

import http from 'http';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import PluginLoader from './lib/plugin-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || '/gm';
const PLUGIN_DIR = path.join(__dirname, 'lib', 'plugins');

// Create Express app
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'static')));

// Plugin loader
const pluginLoader = new PluginLoader(PLUGIN_DIR);

// Create HTTP server
const server = http.createServer(app);

// Error handling
process.on('uncaughtException', (err, origin) => {
  console.error('[FATAL] Uncaught exception (contained):', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled rejection (contained):', reason instanceof Error ? reason.message : reason);
});

// Initialize plugins and register routes
async function bootstrap() {
  console.log('[Server] Starting AgentGUI plugin architecture...');

  try {
    // Load all plugins
    await pluginLoader.loadAllPlugins({
      router: app,
      wsManager: null, // WebSocket manager will be set later
      logger: console,
      env: process.env,
    });

    // Register routes from all plugins
    const pluginNames = Array.from(pluginLoader.registry.keys());
    console.log(`[Server] Loaded plugins: ${pluginNames.join(', ')}`);

    for (const name of pluginNames) {
      const state = pluginLoader.get(name);
      if (!state || !state.routes) continue;

      for (const route of state.routes) {
        const fullPath = BASE_URL + route.path;
        console.log(`[Server] Registered ${route.method} ${fullPath}`);
        if (route.method === 'GET') {
          app.get(fullPath, route.handler);
        } else if (route.method === 'POST') {
          app.post(fullPath, route.handler);
        } else if (route.method === 'PUT') {
          app.put(fullPath, route.handler);
        } else if (route.method === 'DELETE') {
          app.delete(fullPath, route.handler);
        }
      }
    }

    // Redirect root to BASE_URL
    app.get('/', (req, res) => {
      res.redirect(BASE_URL + '/');
    });

    // Health check
    app.get(BASE_URL + '/health', (req, res) => {
      res.json({ status: 'ok', plugins: Array.from(pluginLoader.registry.keys()) });
    });

    // Start server
    server.listen(PORT, () => {
      console.log(`[Server] Listening on http://localhost:${PORT}${BASE_URL}/`);
    });

    // Hot reload watcher
    if (process.env.HOT_RELOAD !== 'false') {
      setupHotReload();
    }

    // Graceful shutdown
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    console.error('[Server] Bootstrap failed:', error.message);
    process.exit(1);
  }
}

// Hot reload watcher
function setupHotReload() {
  const watcher = fs.watch(PLUGIN_DIR, { recursive: true }, async (eventType, filename) => {
    if (!filename || !filename.endsWith('.js')) return;

    const pluginName = path.basename(filename, '.js');
    console.log(`[HotReload] Detected change in ${pluginName}`);

    setTimeout(() => {
      pluginLoader.reloadPlugin(pluginName).catch(error => {
        console.error(`[HotReload] Reload failed:`, error.message);
      });
    }, 100);
  });

  process.on('SIGTERM', () => {
    watcher.close();
  });
}

// Graceful shutdown
async function shutdown() {
  console.log('[Server] Shutting down...');
  await pluginLoader.shutdown();
  server.close(() => {
    console.log('[Server] Closed');
    process.exit(0);
  });
}

// Start
bootstrap().catch(error => {
  console.error('[Server] Fatal error:', error);
  process.exit(1);
});

export { server, app, pluginLoader };
