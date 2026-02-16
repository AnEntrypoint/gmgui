import fs from 'fs';
import path from 'path';
import os from 'os';

export function patchWebtalkForWindows(serverTTS) {
  if (process.platform !== 'win32') return;

  const venvDir = path.join(os.homedir(), '.gmgui', 'pocket-venv');

  // Check if pocket-tts exists at Windows paths
  const windowsBinaries = [
    path.join(venvDir, 'Scripts', 'pocket-tts.exe'),
    path.join(venvDir, 'bin', 'pocket-tts.exe'),
    path.join(venvDir, 'bin', 'pocket-tts'),
  ];

  const found = windowsBinaries.find(p => fs.existsSync(p));

  if (found) {
    // Patch the start function to use the correct binary
    const originalStart = serverTTS.start;

    serverTTS.start = function(voicePath, options) {
      if (!options) options = {};
      if (!options.binaryPaths) options.binaryPaths = [];

      // Ensure Windows paths are first
      options.binaryPaths = [...windowsBinaries, ...options.binaryPaths];

      return originalStart.call(this, voicePath, options);
    };
  }
}
