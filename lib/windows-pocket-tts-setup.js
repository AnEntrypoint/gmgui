import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const PYTHON_VERSION_MIN = [3, 9];
const VENV_DIR = path.join(os.homedir(), '.gmgui', 'pocket-venv');
const isWin = process.platform === 'win32';
const EXECUTABLE_NAME = isWin ? 'pocket-tts.exe' : 'pocket-tts';

function getPocketTtsPath() {
  if (isWin) {
    return path.join(VENV_DIR, 'Scripts', EXECUTABLE_NAME);
  }
  return path.join(VENV_DIR, 'bin', EXECUTABLE_NAME);
}

function detectPython() {
  try {
    const versionOutput = execSync('python --version', { encoding: 'utf-8' }).trim();
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
    if (onProgress) onProgress({ step: 'verifying', status: 'success', message: 'pocket-tts already installed' });
    return { success: true };
  }

  if (onProgress) onProgress({ step: 'creating-venv', status: 'in-progress', message: `Creating virtual environment at ${VENV_DIR}` });

  try {
    const mkdirResult = execSync(`python -m venv "${VENV_DIR}"`, { encoding: 'utf-8', stdio: 'pipe' });
    if (onProgress) onProgress({ step: 'creating-venv', status: 'success', message: 'Virtual environment created' });
  } catch (e) {
    const msg = `Failed to create venv: ${e.message || e.stderr || e}`;
    if (onProgress) onProgress({ step: 'creating-venv', status: 'error', message: msg });
    return { success: false, error: msg };
  }

  if (onProgress) onProgress({ step: 'installing', status: 'in-progress', message: 'Installing pocket-tts via pip (this may take a minute)' });

  try {
    const pipCmd = isWin
      ? `"${path.join(VENV_DIR, 'Scripts', 'pip')}" install pocket-tts`
      : `"${path.join(VENV_DIR, 'bin', 'pip')}" install pocket-tts`;

    const installResult = execSync(pipCmd, { encoding: 'utf-8', stdio: 'pipe', timeout: 300000 });
    if (onProgress) onProgress({ step: 'installing', status: 'success', message: 'pocket-tts installed successfully' });
  } catch (e) {
    const msg = `Failed to install pocket-tts: ${e.message || e.stderr || e}`;
    if (onProgress) onProgress({ step: 'installing', status: 'error', message: msg });
    return { success: false, error: msg };
  }

  if (onProgress) onProgress({ step: 'verifying', status: 'in-progress', message: 'Verifying installation' });

  const exePath = getPocketTtsPath();
  const binDir = path.join(VENV_DIR, 'bin');
  const binExePath = path.join(binDir, 'pocket-tts');

  if (!fs.existsSync(exePath)) {
    const msg = `pocket-tts binary not found at ${exePath}`;
    if (onProgress) onProgress({ step: 'verifying', status: 'error', message: msg });
    return { success: false, error: msg };
  }

  // On Windows, webtalk looks for pocket-tts in bin/ (Unix path structure)
  // Copy the executable there for compatibility with Node.js spawn()
  if (isWin) {
    try {
      fs.mkdirSync(binDir, { recursive: true });
    } catch (e) {}

    // Copy pocket-tts.exe to bin folder
    const exeWithExt = path.join(binDir, 'pocket-tts.exe');
    if (fs.existsSync(exePath) && !fs.existsSync(exeWithExt)) {
      try {
        fs.copyFileSync(exePath, exeWithExt);
      } catch (e) {}
    }

    // Create a batch file wrapper for Node.js spawn compatibility
    const batchFile = path.join(binDir, 'pocket-tts.bat');
    if (!fs.existsSync(batchFile) && fs.existsSync(exeWithExt)) {
      try {
        const batchContent = `@echo off\nsetlocal enabledelayedexpansion\nset PYTHONUNBUFFERED=1\nset HF_HUB_DISABLE_SYMLINKS_WARNING=1\n"${exeWithExt}" %*\n`;
        fs.writeFileSync(batchFile, batchContent, 'utf-8');
      } catch (e) {}
    }
  }

  if (onProgress) onProgress({ step: 'verifying', status: 'success', message: 'pocket-tts ready' });

  return { success: true };
}

export { detectPython, isSetup, install, getPocketTtsPath, VENV_DIR };
