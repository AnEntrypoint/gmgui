// Plugin interface contract - every plugin must implement this

export default {
  // Plugin metadata
  name: 'plugin-name', // unique identifier
  version: '1.0.0',
  dependencies: [], // list of other plugin names this depends on

  // Lifecycle methods (all required)
  async init(config, plugins) {
    // config = { router, wsManager, db, logger, env }
    // plugins = Map<name, plugin> of all loaded plugins
    // MUST return: { routes[], wsHandlers{}, api{}, stop() }
    return {
      routes: [], // [ { method, path, handler } ]
      wsHandlers: {}, // { eventType: handler(data, clients) }
      api: {}, // exported functions for other plugins
    };
  },

  async reload(state) {
    // Called on hot reload. Preserve state from previous instance.
    // Return new state (or updated state from previous)
    return state;
  },

  async stop() {
    // Graceful shutdown. Clean up resources.
    // No need to return anything.
  },

  // Optional: Called when another plugin throws error
  async handleError(error, context) {
    // context = { pluginName, phase, ... }
  },
};
