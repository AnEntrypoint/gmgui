import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

function err(code, message) { const e = new Error(message); e.code = code; throw e; }

export function register(router, deps) {
  const { queries, wsOptimizer, modelDownloadState, ensureModelsDownloaded,
    broadcastSync, getSpeech, getProviderConfigs, saveProviderConfig,
    startGeminiOAuth, exchangeGeminiOAuthCode, geminiOAuthState,
    STARTUP_CWD } = deps;

  router.handle('home', () => ({ home: os.homedir(), cwd: STARTUP_CWD }));

  router.handle('folders', (p) => {
    const folderPath = p.path || STARTUP_CWD;
    try {
      const expanded = folderPath.startsWith('~') ? folderPath.replace('~', os.homedir()) : folderPath;
      const entries = fs.readdirSync(expanded, { withFileTypes: true });
      const folders = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => ({ name: e.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { folders };
    } catch (e) { err(400, e.message); }
  });

  router.handle('clone', (p) => {
    const repo = (p.repo || '').trim();
    if (!repo || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
      err(400, 'Invalid repo format. Use org/repo or user/repo');
    }
    const cloneDir = STARTUP_CWD || os.homedir();
    const repoName = repo.split('/')[1];
    const targetPath = path.join(cloneDir, repoName);
    if (fs.existsSync(targetPath)) err(409, `Directory already exists: ${repoName}`);
    try {
      const isWindows = os.platform() === 'win32';
      execSync('git clone https://github.com/' + repo + '.git', {
        cwd: cloneDir, encoding: 'utf-8', timeout: 120000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        shell: isWindows
      });
      return { ok: true, repo, path: targetPath, name: repoName };
    } catch (e) { err(500, (e.stderr || e.message || 'Clone failed').trim()); }
  });

  router.handle('git.check', () => {
    try {
      const isWindows = os.platform() === 'win32';
      const devnull = isWindows ? '' : ' 2>/dev/null';
      const remoteUrl = execSync('git remote get-url origin' + devnull, { encoding: 'utf-8', cwd: STARTUP_CWD, shell: isWindows }).trim();
      const statusResult = execSync('git status --porcelain' + devnull, { encoding: 'utf-8', cwd: STARTUP_CWD, shell: isWindows });
      const hasChanges = statusResult.trim().length > 0;
      const unpushedResult = execSync('git rev-list --count --not --remotes' + devnull, { encoding: 'utf-8', cwd: STARTUP_CWD, shell: isWindows });
      const hasUnpushed = parseInt(unpushedResult.trim() || '0', 10) > 0;
      const ownsRemote = !remoteUrl.includes('github.com/') || remoteUrl.includes(process.env.GITHUB_USER || '');
      return { ownsRemote, hasChanges, hasUnpushed, remoteUrl };
    } catch {
      return { ownsRemote: false, hasChanges: false, hasUnpushed: false, remoteUrl: '' };
    }
  });

  router.handle('git.push', () => {
    try {
      const isWindows = os.platform() === 'win32';
      const cmd = isWindows
        ? 'git add -A & git commit -m "Auto-commit" & git push'
        : 'git add -A && git commit -m "Auto-commit" && git push';
      execSync(cmd, { encoding: 'utf-8', cwd: STARTUP_CWD, shell: isWindows });
      return { success: true };
    } catch (e) { err(500, e.message); }
  });

  router.handle('speech.status', async () => {
    try {
      const { getStatus } = await getSpeech();
      const base = getStatus();
      let pythonDetected = false, pythonVersion = null;
      try {
        const { createRequire } = await import('module');
        const r = createRequire(import.meta.url);
        const serverTTS = r('webtalk/server-tts');
        if (typeof serverTTS.detectPython === 'function') {
          const py = serverTTS.detectPython();
          pythonDetected = py.found;
          pythonVersion = py.version || null;
        }
      } catch {}
      return {
        ...base, pythonDetected, pythonVersion,
        setupMessage: base.ttsReady ? 'pocket-tts ready' : 'Will setup on first TTS request',
        modelsDownloading: modelDownloadState.downloading,
        modelsComplete: modelDownloadState.complete,
        modelsError: modelDownloadState.error,
        modelsProgress: modelDownloadState.progress,
      };
    } catch {
      return {
        sttReady: false, ttsReady: false, sttLoading: false, ttsLoading: false,
        setupMessage: 'Will setup on first TTS request',
        modelsDownloading: modelDownloadState.downloading,
        modelsComplete: modelDownloadState.complete,
        modelsError: modelDownloadState.error,
      };
    }
  });

  router.handle('speech.download', () => {
    if (modelDownloadState.complete) return { ok: true, modelsComplete: true, message: 'Models already ready' };
    if (!modelDownloadState.downloading) {
      modelDownloadState.error = null;
      ensureModelsDownloaded().then(ok => {
        broadcastSync({ type: 'model_download_progress', progress: { done: true, complete: ok, error: ok ? null : 'Download failed' } });
      }).catch(e => {
        broadcastSync({ type: 'model_download_progress', progress: { done: true, error: e.message } });
      });
    }
    return { ok: true, message: 'Starting model download' };
  });

  router.handle('voices', async () => {
    try {
      const { getVoices } = await getSpeech();
      return { ok: true, voices: getVoices() };
    } catch { return { ok: true, voices: [] }; }
  });

  router.handle('auth.configs', () => getProviderConfigs());

  router.handle('auth.save', (p) => {
    const { providerId, apiKey, defaultModel } = p;
    if (typeof providerId !== 'string' || !providerId.length || providerId.length > 100) err(400, 'Invalid providerId');
    if (typeof apiKey !== 'string' || !apiKey.length || apiKey.length > 10000) err(400, 'Invalid apiKey');
    if (defaultModel !== undefined && (typeof defaultModel !== 'string' || defaultModel.length > 200)) err(400, 'Invalid defaultModel');
    const configPath = saveProviderConfig(providerId, apiKey, defaultModel || '');
    return { success: true, path: configPath };
  });

  router.handle('import.claude', () => ({ imported: queries.importClaudeCodeConversations() }));

  router.handle('discover.claude', () => ({ discovered: queries.discoverClaudeCodeConversations() }));

  router.handle('gemini.start', async () => {
    try {
      const result = await startGeminiOAuth();
      return { authUrl: result.authUrl, mode: result.mode };
    } catch (e) { err(500, e.message); }
  });

  router.handle('gemini.status', () => {
    const st = typeof geminiOAuthState === 'function' ? geminiOAuthState() : geminiOAuthState;
    return st;
  });

  router.handle('gemini.relay', async (p) => {
    const { code, state } = p;
    if (!code || !state) err(400, 'Missing code or state');
    try {
      const email = await exchangeGeminiOAuthCode(code, state);
      return { success: true, email };
    } catch (e) { err(400, e.message); }
  });

  router.handle('gemini.complete', async (p) => {
    const pastedUrl = (p.url || '').trim();
    if (!pastedUrl) err(400, 'No URL provided');
    let parsed;
    try { parsed = new URL(pastedUrl); } catch { err(400, 'Invalid URL. Paste the full URL from the browser address bar.'); }
    const urlError = parsed.searchParams.get('error');
    if (urlError) {
      const desc = parsed.searchParams.get('error_description') || urlError;
      return { error: desc };
    }
    const code = parsed.searchParams.get('code');
    const state = parsed.searchParams.get('state');
    try {
      const email = await exchangeGeminiOAuthCode(code, state);
      return { success: true, email };
    } catch (e) { err(400, e.message); }
  });

  router.handle('ws.stats', () => wsOptimizer.getStats());
}
