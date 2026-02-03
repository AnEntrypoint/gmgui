import fs from 'fs';
import path from 'path';
import os from 'os';
import { queries } from './database.js';

/**
 * ConversationSync - Watches for changes to Claude Code conversation files
 * and keeps the database synchronized with the latest versions
 */
export class ConversationSync {
  constructor() {
    this.watchers = new Map();
    this.lastSync = new Map();
    this.syncInterval = 5000; // Check for changes every 5 seconds
    this.isRunning = false;
  }

  /**
   * Start watching for conversation file changes
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Watch for changes to sessions-index.json files
    this.watchProjectDirectory();

    // Periodic sync check
    this.syncCheckInterval = setInterval(() => {
      this.checkForUpdates();
    }, this.syncInterval);

    console.log('[ConversationSync] Started watching for conversation changes');
  }

  /**
   * Stop watching for changes
   */
  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;

    // Clear all watchers
    for (const [, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();

    // Clear interval
    if (this.syncCheckInterval) {
      clearInterval(this.syncCheckInterval);
    }

    console.log('[ConversationSync] Stopped watching for conversation changes');
  }

  /**
   * Watch the .claude/projects directory for changes
   */
  watchProjectDirectory() {
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    if (!fs.existsSync(projectsDir)) {
      console.log('[ConversationSync] Projects directory does not exist:', projectsDir);
      return;
    }

    try {
      const watcher = fs.watch(projectsDir, { recursive: true }, (eventType, filename) => {
        if (filename && filename.endsWith('sessions-index.json')) {
          this.handleFileChange(projectsDir, filename);
        }
      });

      this.watchers.set(projectsDir, watcher);
      console.log('[ConversationSync] Watching:', projectsDir);
    } catch (err) {
      console.error('[ConversationSync] Error setting up file watcher:', err.message);
    }
  }

  /**
   * Handle changes to sessions-index.json files
   */
  handleFileChange(projectsDir, filename) {
    const fullPath = path.join(projectsDir, filename);

    // Debounce rapid changes
    if (this.lastSync.has(fullPath)) {
      const lastTime = this.lastSync.get(fullPath);
      if (Date.now() - lastTime < 1000) {
        return; // Skip if changed within last second
      }
    }

    this.lastSync.set(fullPath, Date.now());
    this.syncConversationFile(fullPath);
  }

  /**
   * Sync a specific sessions-index.json file
   */
  syncConversationFile(indexPath) {
    try {
      if (!fs.existsSync(indexPath)) return;

      const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      const entries = index.entries || [];
      let synced = 0;
      let updated = 0;

      for (const entry of entries) {
        const existing = queries.getConversationByExternalId('claude-code', entry.sessionId);

        if (existing) {
          // Check if conversation has been updated
          const existingModified = new Date(existing.modified).getTime();
          const newModified = new Date(entry.modified).getTime();

          if (newModified > existingModified) {
            // Update with new information
            queries.updateConversation(existing.id, {
              title: entry.summary || entry.firstPrompt || `Conversation ${entry.sessionId.slice(0, 8)}`,
              messageCount: entry.messageCount || 0,
              modified: newModified
            });
            updated++;
          }
        } else {
          // New conversation - import it
          const conversation = {
            externalId: entry.sessionId,
            agentType: 'claude-code',
            title: entry.summary || entry.firstPrompt || `Conversation ${entry.sessionId.slice(0, 8)}`,
            firstPrompt: entry.firstPrompt,
            messageCount: entry.messageCount || 0,
            created: new Date(entry.created).getTime(),
            modified: new Date(entry.modified).getTime(),
            projectPath: entry.projectPath,
            gitBranch: entry.gitBranch,
            sourcePath: entry.fullPath,
            source: 'imported'
          };

          queries.createImportedConversation(conversation);
          synced++;
        }
      }

      if (synced > 0 || updated > 0) {
        console.log(`[ConversationSync] File: ${path.basename(indexPath)} - synced: ${synced}, updated: ${updated}`);
      }
    } catch (err) {
      console.error('[ConversationSync] Error syncing file:', indexPath, err.message);
    }
  }

  /**
   * Periodic check for any missed updates
   */
  checkForUpdates() {
    try {
      const projectsDir = path.join(os.homedir(), '.claude', 'projects');
      if (!fs.existsSync(projectsDir)) return;

      const projects = fs.readdirSync(projectsDir);

      for (const projectName of projects) {
        const indexPath = path.join(projectsDir, projectName, 'sessions-index.json');
        if (fs.existsSync(indexPath)) {
          // Check file's modification time
          const stat = fs.statSync(indexPath);
          const lastModified = stat.mtime.getTime();
          const lastSyncTime = this.lastSync.get(indexPath) || 0;

          if (lastModified > lastSyncTime) {
            this.syncConversationFile(indexPath);
          }
        }
      }
    } catch (err) {
      console.error('[ConversationSync] Error during periodic check:', err.message);
    }
  }
}

// Singleton instance
let syncInstance = null;

export function getConversationSync() {
  if (!syncInstance) {
    syncInstance = new ConversationSync();
  }
  return syncInstance;
}

export default ConversationSync;
