#!/usr/bin/env node
/**
 * Patch script to fix Windows path duplication issue in fsbrowse
 * Fixes: Error ENOENT: no such file or directory, scandir 'C:\C:\dev'
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fsbrowsePath = path.join(__dirname, '..', 'node_modules', 'fsbrowse', 'index.js');

if (!fs.existsSync(fsbrowsePath)) {
  console.warn('[PATCH] fsbrowse not found, skipping patch');
  process.exit(0);
}

try {
  let content = fs.readFileSync(fsbrowsePath, 'utf8');

  // Check if patch is already applied
  if (content.includes('sanitizedIsAbsoluteOnDrive')) {
    console.log('[PATCH] fsbrowse Windows path fix already applied');
    process.exit(0);
  }

  // Replace the makeResolver function with the fixed version
  const oldMakeResolver = `function makeResolver(baseDir) {
  return function resolveWithBaseDir(relPath) {
    const sanitized = sanitizePath(relPath);
    const fullPath = path.resolve(baseDir, sanitized);
    if (!fullPath.startsWith(baseDir)) {
      return { ok: false, error: 'EPATHINJECTION' };
    }
    return { ok: true, path: fullPath };
  };
}`;

  const newMakeResolver = `function makeResolver(baseDir) {
  const normalizedBase = path.normalize(baseDir);
  const baseDriveLetter = normalizedBase.match(/^[A-Z]:/i)?.[0];

  return function resolveWithBaseDir(relPath) {
    const sanitized = sanitizePath(relPath);
    let fullPath;

    // Extract drive letter from both paths to check for same-drive duplication on Windows
    const sanitizedDriveLetter = sanitized.match(/^[A-Z]:/i)?.[0];
    const sanitizedIsAbsoluteOnDrive = /^[A-Z]:/i.test(sanitized);

    // If both paths are on the same Windows drive, strip the drive letter from relPath
    // to avoid duplication like C:\\C:\\dev
    if (baseDriveLetter && sanitizedIsAbsoluteOnDrive && sanitizedDriveLetter === baseDriveLetter) {
      // Remove drive letter and leading slashes to make it relative
      const relativePath = sanitized.replace(/^[A-Z]:(?:\/|\\)?/i, '');
      fullPath = path.resolve(normalizedBase, relativePath);
    } else {
      fullPath = path.resolve(normalizedBase, sanitized);
    }

    // Normalize for consistent comparison
    const normalizedFullPath = path.normalize(fullPath);
    const normalizedComparisonBase = path.normalize(normalizedBase);

    // Check path injection - convert backslashes to forward slashes for comparison
    const normalizedCheck = normalizedFullPath.replace(/\\\\/g, '/');
    const normalizedBaseCheck = normalizedComparisonBase.replace(/\\\\/g, '/');

    if (!normalizedCheck.startsWith(normalizedBaseCheck)) {
      return { ok: false, error: 'EPATHINJECTION' };
    }
    return { ok: true, path: normalizedFullPath };
  };
}`;

  if (content.includes(oldMakeResolver)) {
    content = content.replace(oldMakeResolver, newMakeResolver);
    fs.writeFileSync(fsbrowsePath, content, 'utf8');
    console.log('[PATCH] fsbrowse Windows path fix applied successfully');
  } else {
    console.warn('[PATCH] Could not find makeResolver function to patch');
  }
} catch (err) {
  console.error('[PATCH] Error applying fsbrowse patch:', err.message);
  process.exit(1);
}
