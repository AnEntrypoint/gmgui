import { spawn } from 'child_process';
import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';

const isWindows = os.platform() === 'win32';
const INSTALL_TIMEOUT_MS = 300000;
const VERSION_TIMEOUT_MS = 3000;
const REGISTRY_TIMEOUT_MS = 5000;
const VERSION_CACHE_MS = 3600000;

const TOOLS = [
  { id: 'gm-oc', name: 'OpenCode', pkg: 'gm-oc', binary: 'opencode', marker: path.join(os.homedir(), '.config', 'opencode', 'agents') },
  { id: 'gm-gc', name: 'Gemini CLI', pkg: 'gm-gc', binary: 'gemini', marker: path.join(os.homedir(), '.gemini', 'extensions', 'gm', 'agents') },
  { id: 'gm-kilo', name: 'Kilo', pkg: '@kilocode/cli', binary: 'kilo', marker: path.join(os.homedir(), '.config', 'kilo', 'agents') },
  { id: 'gm-cc', name: 'Claude Code', pkg: '@anthropic-sdk/claude-code', binary: 'claude', marker: path.join(os.homedir(), '.config', 'claude', 'agents') },
];

const versionCache = new Map();
const installLocks = new Map();

function log(msg) { console.log('[TOOL-MANAGER] ' + msg); }

function getTool(toolId) {
  return TOOLS.find(t => t.id === toolId);
}

export function checkToolStatus(toolId) {
  const tool = getTool(toolId);
  if (!tool) return null;

  const timestamp = Date.now();
  let installed = false;
  let hasConfig = false;
  let version = null;

  const ext = isWindows ? '.cmd' : '';
  const localBin = path.join(process.cwd(), 'node_modules', '.bin', tool.binary + ext);
  if (fs.existsSync(localBin)) {
    installed = true;
  } else {
    try {
      const which = isWindows ? 'where' : 'which';
      execSync(`${which} ${tool.binary}`, { stdio: 'pipe', timeout: 2000 });
      installed = true;
    } catch (_) {
      installed = false;
    }
  }

  if (fs.existsSync(tool.marker)) {
    hasConfig = true;
  }

  if (installed && !hasConfig) {
    installed = false;
  }

  if (installed) {
    version = detectVersionSync(tool);
  }

  return { toolId, installed, version, hasConfig, timestamp };
}

function detectVersionSync(tool) {
  try {
    const output = execSync(`${tool.binary} --version 2>&1 || ${tool.binary} -v 2>&1`, {
      timeout: VERSION_TIMEOUT_MS,
      encoding: 'utf8',
      stdio: 'pipe'
    });
    const match = output.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch (_) {
    return null;
  }
}

export async function checkForUpdates(toolId, currentVersion) {
  const tool = getTool(toolId);
  if (!tool || !currentVersion) return { hasUpdate: false, latestVersion: null };

  try {
    const cached = versionCache.get(toolId);
    if (cached && Date.now() - cached.timestamp < VERSION_CACHE_MS) {
      return compareVersions(currentVersion, cached.version) ? { hasUpdate: true, latestVersion: cached.version } : { hasUpdate: false };
    }

    const response = await fetch(`https://registry.npmjs.org/${tool.pkg}`, {
      timeout: REGISTRY_TIMEOUT_MS,
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) return { hasUpdate: false, latestVersion: null };

    const data = await response.json();
    const latestVersion = data['dist-tags']?.latest;

    if (latestVersion) {
      versionCache.set(toolId, { version: latestVersion, timestamp: Date.now() });
      return { hasUpdate: compareVersions(currentVersion, latestVersion), latestVersion };
    }

    return { hasUpdate: false, latestVersion: null };
  } catch (_) {
    return { hasUpdate: false, latestVersion: null };
  }
}

function compareVersions(v1, v2) {
  const p1 = v1.split('.').map(Number);
  const p2 = v2.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n1 > n2) return false;
    if (n1 < n2) return true;
  }
  return false;
}

export async function install(toolId, onProgress) {
  const tool = getTool(toolId);
  if (!tool) return { success: false, error: 'Tool not found' };

  if (installLocks.get(toolId)) {
    return { success: false, error: 'Install already in progress' };
  }

  installLocks.set(toolId, true);

  try {
    return new Promise((resolve) => {
      const npxCmd = isWindows ? 'npx.cmd' : 'npx';
      const proc = spawn(npxCmd, ['--yes', tool.pkg], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: INSTALL_TIMEOUT_MS,
        shell: isWindows
      });

      let stdout = '';
      let stderr = '';
      let completed = false;

      const timer = setTimeout(() => {
        if (!completed) {
          completed = true;
          try { proc.kill('SIGKILL'); } catch (_) {}
          resolve({ success: false, error: 'Installation timeout (5 minutes)' });
        }
      }, INSTALL_TIMEOUT_MS);

      proc.stdout.on('data', (d) => {
        stdout += d.toString();
        if (onProgress) onProgress({ type: 'progress', data: d.toString() });
      });

      proc.stderr.on('data', (d) => {
        stderr += d.toString();
        if (onProgress) onProgress({ type: 'error', data: d.toString() });
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (completed) return;
        completed = true;

        if (code === 0) {
          const status = checkToolStatus(toolId);
          if (status && status.installed) {
            resolve({ success: true, error: null, version: status.version });
          } else {
            resolve({ success: false, error: 'Install completed but tool not detected' });
          }
        } else {
          const error = stderr.substring(0, 1000) || 'Installation failed';
          resolve({ success: false, error });
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        if (completed) return;
        completed = true;
        resolve({ success: false, error: err.message });
      });
    });
  } finally {
    installLocks.delete(toolId);
  }
}

export async function update(toolId, targetVersion, onProgress) {
  const tool = getTool(toolId);
  if (!tool) return { success: false, error: 'Tool not found' };

  const current = checkToolStatus(toolId);
  if (!current || !current.installed) {
    return { success: false, error: 'Tool not installed' };
  }

  if (installLocks.get(toolId)) {
    return { success: false, error: 'Install already in progress' };
  }

  const target = targetVersion || await checkForUpdates(toolId, current.version).then(r => r.latestVersion);
  if (!target) {
    return { success: false, error: 'Unable to determine target version' };
  }

  installLocks.set(toolId, true);

  try {
    return new Promise((resolve) => {
      const npxCmd = isWindows ? 'npx.cmd' : 'npx';
      const pkg = `${tool.pkg}@${target}`;
      const proc = spawn(npxCmd, ['--yes', pkg], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: INSTALL_TIMEOUT_MS,
        shell: isWindows
      });

      let stderr = '';
      let completed = false;

      const timer = setTimeout(() => {
        if (!completed) {
          completed = true;
          try { proc.kill('SIGKILL'); } catch (_) {}
          resolve({ success: false, error: 'Update timeout (5 minutes)' });
        }
      }, INSTALL_TIMEOUT_MS);

      proc.stdout.on('data', (d) => {
        if (onProgress) onProgress({ type: 'progress', data: d.toString() });
      });

      proc.stderr.on('data', (d) => {
        stderr += d.toString();
        if (onProgress) onProgress({ type: 'error', data: d.toString() });
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (completed) return;
        completed = true;

        if (code === 0) {
          const status = checkToolStatus(toolId);
          if (status && status.installed) {
            resolve({ success: true, error: null, version: status.version });
          } else {
            resolve({ success: false, error: 'Update completed but tool not detected' });
          }
        } else {
          const error = stderr.substring(0, 1000) || 'Update failed';
          resolve({ success: false, error });
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        if (completed) return;
        completed = true;
        resolve({ success: false, error: err.message });
      });
    });
  } finally {
    installLocks.delete(toolId);
  }
}

export function getAllTools() {
  return TOOLS.map(tool => {
    const status = checkToolStatus(tool.id);
    return { ...tool, ...status };
  });
}

export function getToolConfig(toolId) {
  return getTool(toolId) || null;
}
