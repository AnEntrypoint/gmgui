/**
 * Hot Reload Manager
 * Enables live reloading of client code and graceful server restarts without losing connections
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class HotReloadManager {
  constructor(staticDir, options = {}) {
    this.staticDir = staticDir;
    this.watchedFiles = new Map();
    this.hotReloadClients = [];
    this.debounceTimers = new Map();
    this.debounceDelay = options.debounceDelay || 300;
    this.enabled = options.enabled !== false;
  }

  /**
   * Start watching files for changes
   */
  start() {
    if (!this.enabled) return;
    
    try {
      this.watchDirectory(this.staticDir);
      console.log('[HotReload] Watching for changes:', this.staticDir);
    } catch (e) {
      console.error('[HotReload] Failed to start:', e.message);
    }
  }

  /**
   * Watch directory recursively
   */
  watchDirectory(dir) {
    try {
      const files = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const file of files) {
        const fullPath = path.join(dir, file.name);
        
        if (file.isDirectory()) {
          this.watchDirectory(fullPath);
        } else {
          this.watchFile(fullPath);
        }
      }
    } catch (e) {
      console.error('[HotReload] Error watching directory:', e.message);
    }
  }

  /**
   * Watch individual file for changes
   */
  watchFile(filePath) {
    if (this.watchedFiles.has(filePath)) return;

    try {
      fs.watchFile(filePath, { interval: 100 }, (curr, prev) => {
        if (curr.mtime > prev.mtime) {
          this.onFileChanged(filePath);
        }
      });

      this.watchedFiles.set(filePath, true);
    } catch (e) {
      console.error('[HotReload] Error watching file:', e.message);
    }
  }

  /**
   * Handle file change with debouncing
   */
  onFileChanged(filePath) {
    // Clear existing timer for this file
    if (this.debounceTimers.has(filePath)) {
      clearTimeout(this.debounceTimers.get(filePath));
    }

    // Set new debounced timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      const relPath = path.relative(this.staticDir, filePath);
      
      console.log(`[HotReload] File changed: ${relPath}`);
      this.broadcastReload();
    }, this.debounceDelay);

    this.debounceTimers.set(filePath, timer);
  }

  /**
   * Register a WebSocket client for hot reload
   */
  registerClient(ws) {
    if (!this.enabled) return;
    this.hotReloadClients.push(ws);
    
    ws.on('close', () => {
      const idx = this.hotReloadClients.indexOf(ws);
      if (idx > -1) this.hotReloadClients.splice(idx, 1);
    });
  }

  /**
   * Broadcast reload signal to all connected clients
   */
  broadcastReload() {
    const message = JSON.stringify({ type: 'reload', timestamp: Date.now() });
    
    for (const ws of this.hotReloadClients) {
      if (ws.readyState === 1) { // WebSocket.OPEN
        try {
          ws.send(message);
        } catch (e) {
          // Client may have disconnected
        }
      }
    }
  }

  /**
   * Cleanup watchers
   */
  stop() {
    for (const filePath of this.watchedFiles.keys()) {
      try {
        fs.unwatchFile(filePath);
      } catch (e) {}
    }
    
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    
    this.watchedFiles.clear();
    this.debounceTimers.clear();
    this.hotReloadClients = [];
  }

  /**
   * Get HTML snippet to inject for hot reload
   */
  getClientScript(baseUrl = '') {
    if (!this.enabled) return '';

    return `
<script>
(function() {
  const baseUrl = '${baseUrl}';
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + baseUrl + '/hot-reload');
  
  ws.onmessage = function(event) {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'reload') {
        console.log('[HotReload] Reloading page...');
        location.reload();
      }
    } catch (e) {
      console.error('[HotReload] Error parsing message:', e);
    }
  };
  
  ws.onerror = function(e) {
    console.log('[HotReload] WebSocket error:', e);
  };
  
  ws.onclose = function() {
    console.log('[HotReload] Connection closed, will attempt to reconnect...');
    setTimeout(function() {
      location.reload();
    }, 2000);
  };
})();
</script>
    `;
  }
}

export default HotReloadManager;
