import fs from 'fs';
import path from 'path';
import os from 'os';
import { queries } from './database.js';

export class ConversationImporter {
  static async importClaudeCodeSessions() {
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    if (!fs.existsSync(projectsDir)) return [];

    const imported = [];
    const projects = fs.readdirSync(projectsDir);

    for (const projectName of projects) {
      const indexPath = path.join(projectsDir, projectName, 'sessions-index.json');
      if (!fs.existsSync(indexPath)) continue;

      try {
        const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        const entries = index.entries || [];

        for (const entry of entries) {
          try {
            const existing = queries.getConversationByExternalId('claude-code', entry.sessionId);
            if (existing) continue;

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
            imported.push(conversation);
          } catch (err) {
            console.error(`[Importer] Error importing session ${entry.sessionId}:`, err.message);
          }
        }
      } catch (err) {
        console.error(`[Importer] Error reading ${indexPath}:`, err.message);
      }
    }

    return imported;
  }

  static async importOpenCodeSessions() {
    // TODO: Implement OpenCode session import once storage location is determined
    return [];
  }

  static async importAll() {
    console.log('[Importer] Starting conversation import...');
    const claudeCode = await this.importClaudeCodeSessions();
    const openCode = await this.importOpenCodeSessions();
    console.log(`[Importer] Imported ${claudeCode.length} Claude Code conversations`);
    console.log(`[Importer] Imported ${openCode.length} OpenCode conversations`);
    return { claudeCode, openCode };
  }
}

export default ConversationImporter;
