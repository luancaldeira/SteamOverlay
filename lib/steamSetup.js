'use strict';
// Locate the Steam install (Windows registry), manage the CEF remote-debugging
// flag file, and check whether Steam is running.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const FLAG_NAME = '.cef-enable-remote-debugging';

function regQuery(root, key, value) {
  return new Promise((resolve) => {
    execFile('reg', ['query', `${root}\\${key}`, '/v', value], { windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      // line like: "    SteamPath    REG_SZ    c:/program files (x86)/steam"
      const re = new RegExp(`${value}\\s+REG_[A-Z_]+\\s+(.+)`, 'i');
      const m = stdout.match(re);
      resolve(m ? m[1].trim() : null);
    });
  });
}

async function findSteamPath() {
  let p = await regQuery('HKCU', 'Software\\Valve\\Steam', 'SteamPath');
  if (!p) p = await regQuery('HKLM', 'SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath');
  if (!p) {
    // last-resort common default
    const guess = 'C:\\Program Files (x86)\\Steam';
    if (fs.existsSync(guess)) p = guess;
  }
  if (!p) return null;
  return path.normalize(p.replace(/\//g, path.sep));
}

function isSteamRunning() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', 'IMAGENAME eq steam.exe', '/NH'], { windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve(false);
      resolve(/steam\.exe/i.test(stdout));
    });
  });
}

// Returns { steamPath, flagPath, flagExists, created, error }
async function ensureDebugFlag({ create = true } = {}) {
  const steamPath = await findSteamPath();
  if (!steamPath) {
    return { steamPath: null, flagPath: null, flagExists: false, created: false, error: 'steam-not-found' };
  }
  const flagPath = path.join(steamPath, FLAG_NAME);
  let flagExists = fs.existsSync(flagPath);
  let created = false;
  if (!flagExists && create) {
    try {
      fs.writeFileSync(flagPath, '');
      flagExists = true;
      created = true;
    } catch (e) {
      return { steamPath, flagPath, flagExists: false, created: false, error: e.message };
    }
  }
  return { steamPath, flagPath, flagExists, created, error: null };
}

// Check-only: does the flag exist right now (without creating it)?
async function debugFlagStatus() {
  const steamPath = await findSteamPath();
  if (!steamPath) return { steamPath: null, flagPath: null, flagExists: false };
  const flagPath = path.join(steamPath, FLAG_NAME);
  return { steamPath, flagPath, flagExists: fs.existsSync(flagPath) };
}

module.exports = { findSteamPath, isSteamRunning, ensureDebugFlag, debugFlagStatus, FLAG_NAME };
