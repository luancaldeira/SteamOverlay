'use strict';
// Resolve the per-user data directory. Works both inside Electron (where the
// `electron` module exports the API) and under plain `node --test` (where
// requiring `electron` yields the binary path string, not the API).

const os = require('os');
const path = require('path');
const fs = require('fs');

const APP_DIR_NAME = 'steam-spec-overlay';

let cachedDir = null;

function fromElectron() {
  try {
    const electron = require('electron');
    if (electron && electron.app && typeof electron.app.getPath === 'function') {
      return electron.app.getPath('userData');
    }
  } catch {
    /* not running under Electron */
  }
  return null;
}

function userDataDir() {
  if (cachedDir) return cachedDir;
  const base =
    fromElectron() ||
    path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), APP_DIR_NAME);
  try {
    fs.mkdirSync(base, { recursive: true });
  } catch {
    /* best effort — callers degrade to in-memory */
  }
  cachedDir = base;
  return base;
}

function dataFile(name) {
  return path.join(userDataDir(), name);
}

// Tests need to point the store at a throwaway directory.
function _setUserDataDir(dir) {
  cachedDir = dir;
  if (dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* ignore */
    }
  }
}

module.exports = { userDataDir, dataFile, _setUserDataDir, APP_DIR_NAME };
