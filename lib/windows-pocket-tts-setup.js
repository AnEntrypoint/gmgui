import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const PYTHON_VERSION_MIN = [3, 9];
const VENV_DIR = path.join(os.homedir(), '.gmgui', 'pocket-venv');
const isWin = process.platform === 'win32';
const EXECUTABLE_NAME = isWin ? 'pocket-tts.exe' : 'pocket-tts';

const CONFIG = {
  PIP_TIMEOUT: 120000,
  VENV_CREATION_TIMEOUT: 30000,
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,
  RETRY_BACKOFF_MULTIPLIER: 2,
};

function getPocketTtsPath() {
  if (isWin) {
    return path.join(VENV_DIR, 'Scripts', EXECUTABLE_NAME);
  }
  return path.join(VENV_DIR, 'bin', EXECUTABLE_NAME);
}

function detectPython() {
  try {
    const versionOutput = execSync('python --version', { encoding: 'utf-8', timeout: 10000 }).trim();
    const match = versionOutput.match(/(\d+)\.(\d+)/);
    if (!match) return { found: false, version: null, error: 'Could not parse version' };

    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);
    const versionOk = major > PYTHON_VERSION_MIN[0] || (major === PYTHON_VERSION_MIN[0] && minor >= PYTHON_VERSION_MIN[1]);

    if (!versionOk) {
      return { found: true, version: `${major}.${minor}`, error: `Python ${major}.${minor} found but ${PYTHON_VERSION_MIN[0]}.${PYTHON_VERSION_MIN[1]}+ required` };
    }

    return { found: true, version: `${major}.${minor}`, error: null };
  } catch (e) {
    return { found: false, version: null, error: 'Python not found in PATH' };
  }
}

function isSetup() {
  const exePath = getPocketTtsPath();
  return fs.existsSync(exePath);
}

function cleanupPartialInstall() {
  try {
    if (fs.existsSync(VENV_DIR)) {
      fs.rmSync(VENV_DIR, { recursive: true, force: true });
      return true;
    }
  } catch (e) {
    console.error(`Failed to cleanup partial install: ${e.message}`);
  }
  return false;
}

function verifyInstallation() {
  const exePath = getPocketTtsPath();
  if (!fs.existsSync(exePath)) {
    return { valid: false, error: `Binary not found at ${exePath}` };
  }

  try {
    const versionOutput = execSync(`"${exePath}" --version`, { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' });
    return { valid: true, version: versionOutput.trim() };
  } catch (e) {
    return { valid: false, error: `Binary exists but failed verification: ${e.message}` };
  }
}

async function executeWithRetry(fn, stepName, maxRetries = CONFIG.MAX_RETRIES) {
  let lastError = null;
  let delayMs = CONFIG.RETRY_DELAY_MS;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastError = e;
      if (attempt < maxRetries) {
        console.log(`Attempt ${attempt}/${maxRetries} failed for ${stepName}, retrying in ${delayMs}ms`);
        await new Promise(r => setTimeout(r, delayMs));
        delayMs *= CONFIG.RETRY_BACKOFF_MULTIPLIER;
      }
    }
  }

  const msg = `${stepName} failed after ${maxRetries} attempts: ${lastError.message || lastError}`;
  throw new Error(msg);
}

async function install(onProgress) {
  const pythonDetect = detectPython();

  if (!pythonDetect.found) {
    const msg = pythonDetect.error || 'Python not found';
    if (onProgress) onProgress({ step: 'detecting-python', status: 'error', message: msg });
    return { success: false, error: msg };
  }

  if (pythonDetect.error) {
    if (onProgress) onProgress({ step: 'detecting-python', status: 'error', message: pythonDetect.error });
    return { success: false, error: pythonDetect.error };
  }

  if (onProgress) onProgress({ step: 'detecting-python', status: 'success', message: `Found Python ${pythonDetect.version}` });

  if (isSetup()) {
    const verify = verifyInstallation();
    if (verify.valid) {
      if (onProgress) onProgress({ step: 'verifying', status: 'success', message: 'pocket-tts already installed' });
      return { success: true };
    }
  }

  if (onProgress) onProgress({ step: 'creating-venv', status: 'in-progress', message: `Creating virtual environment at ${VENV_DIR}` });

  try {
    await executeWithRetry(async (attempt) => {
      return execSync(`python -m venv "${VENV_DIR}"`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: CONFIG.VENV_CREATION_TIMEOUT,
      });
    }, 'venv creation', 2);

    if (onProgress) onProgress({ step: 'creating-venv', status: 'success', message: 'Virtual environment created' });
  } catch (e) {
    const msg = `Failed to create venv: ${e.message || e}`;
    if (onProgress) onProgress({ step: 'creating-venv', status: 'error', message: msg });
    cleanupPartialInstall();
    return { success: false, error: msg };
  }

  if (onProgress) onProgress({ step: 'installing', status: 'in-progress', message: 'Installing pocket-tts via pip (this may take 2-5 minutes on slow connections)' });

  try {
    await executeWithRetry(async (attempt) => {
      if (attempt > 1 && onProgress) {
        onProgress({ step: 'installing', status: 'in-progress', message: `Installing pocket-tts (attempt ${attempt}/${CONFIG.MAX_RETRIES})` });
      }

      const pipCmd = isWin
        ? `"${path.join(VENV_DIR, 'Scripts', 'pip')}" install --no-cache-dir pocket-tts`
        : `"${path.join(VENV_DIR, 'bin', 'pip')}" install --no-cache-dir pocket-tts`;

      return execSync(pipCmd, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: CONFIG.PIP_TIMEOUT,
        env: { ...process.env, PIP_DEFAULT_TIMEOUT: '120' },
      });
    }, 'pip install', CONFIG.MAX_RETRIES);

    if (onProgress) onProgress({ step: 'installing', status: 'success', message: 'pocket-tts installed successfully' });
  } catch (e) {
    const msg = `Failed to install pocket-tts: ${e.message || e}`;
    if (onProgress) onProgress({ step: 'installing', status: 'error', message: msg });
    cleanupPartialInstall();
    return { success: false, error: msg };
  }

  if (onProgress) onProgress({ step: 'verifying', status: 'in-progress', message: 'Verifying installation' });

  const verify = verifyInstallation();
  if (!verify.valid) {
    const msg = verify.error || 'Installation verification failed';
    if (onProgress) onProgress({ step: 'verifying', status: 'error', message: msg });
    cleanupPartialInstall();
    return { success: false, error: msg };
  }

  const exePath = getPocketTtsPath();
  const binDir = path.join(VENV_DIR, 'bin');
  const binExePath = path.join(binDir, 'pocket-tts');

  if (isWin) {
    try {
      fs.mkdirSync(binDir, { recursive: true });
    } catch (e) {}

    const exeWithExt = path.join(binDir, 'pocket-tts.exe');
    if (fs.existsSync(exePath) && !fs.existsSync(exeWithExt)) {
      try {
        fs.copyFileSync(exePath, exeWithExt);
      } catch (e) {}
    }

    const batchFile = path.join(binDir, 'pocket-tts.bat');
    if (!fs.existsSync(batchFile) && fs.existsSync(exeWithExt)) {
      try {
        const batchContent = `@echo off\nsetlocal enabledelayedexpansion\nset PYTHONUNBUFFERED=1\nset HF_HUB_DISABLE_SYMLINKS_WARNING=1\n"${exeWithExt}" %*\n`;
        fs.writeFileSync(batchFile, batchContent, 'utf-8');
      } catch (e) {}
    }
  }

  if (onProgress) onProgress({ step: 'verifying', status: 'success', message: `pocket-tts ready (${verify.version})` });

  return { success: true };
}

export { detectPython, isSetup, install, getPocketTtsPath, VENV_DIR, CONFIG, cleanupPartialInstall, verifyInstallation };
