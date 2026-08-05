'use strict';
// Locate the Steam install (Windows registry), manage the CEF remote-debugging
// flag file, and check whether Steam is running.
//
// The environment loop runs every few seconds for the life of the app, so both
// lookups are memoized: the install path effectively never moves, and the
// process check is throttled. Before this, the overlay spawned two child
// processes every 3 s forever.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const log = require('./logger').scoped('setup');

const FLAG_NAME = '.cef-enable-remote-debugging';
const RUNNING_TTL_MS = 4000;

let steamPathCache = null;
let steamPathAt = 0;
const STEAM_PATH_TTL_MS = 5 * 60 * 1000; // re-check occasionally in case Steam is reinstalled

let runningCache = { value: false, at: 0 };
let runningInFlight = null;

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

async function locateSteam() {
  let p = await regQuery('HKCU', 'Software\\Valve\\Steam', 'SteamPath');
  if (!p) p = await regQuery('HKLM', 'SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath');
  if (!p) p = await regQuery('HKLM', 'SOFTWARE\\Valve\\Steam', 'InstallPath');
  if (!p) {
    // last-resort common defaults
    for (const guess of [
      'C:\\Program Files (x86)\\Steam',
      'C:\\Program Files\\Steam',
      path.join(process.env.LOCALAPPDATA || '', 'Steam'),
    ]) {
      if (guess && fs.existsSync(guess)) {
        p = guess;
        break;
      }
    }
  }
  if (!p) return null;
  return path.normalize(p.replace(/\//g, path.sep));
}

async function findSteamPath({ force = false } = {}) {
  const now = Date.now();
  if (!force && steamPathCache && now - steamPathAt < STEAM_PATH_TTL_MS) return steamPathCache;
  // A cached path that vanished (uninstall/move) must not be trusted.
  if (!force && steamPathCache && fs.existsSync(steamPathCache)) {
    steamPathAt = now;
    return steamPathCache;
  }
  const found = await locateSteam();
  steamPathCache = found;
  steamPathAt = now;
  if (found) log.debug('steam path', found);
  return found;
}

function queryRunning() {
  return new Promise((resolve) => {
    execFile(
      'tasklist',
      ['/FI', 'IMAGENAME eq steam.exe', '/NH', '/FO', 'CSV'],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        if (err || !stdout) return resolve(false);
        resolve(/steam\.exe/i.test(stdout));
      }
    );
  });
}

// Throttled + de-duplicated: concurrent callers share one child process.
function isSteamRunning({ maxAgeMs = RUNNING_TTL_MS } = {}) {
  const now = Date.now();
  if (now - runningCache.at < maxAgeMs) return Promise.resolve(runningCache.value);
  if (runningInFlight) return runningInFlight;
  runningInFlight = queryRunning().then((value) => {
    runningCache = { value, at: Date.now() };
    runningInFlight = null;
    return value;
  });
  return runningInFlight;
}

// Returns { steamPath, flagPath, flagExists, created, error }
async function ensureDebugFlag({ create = true } = {}) {
  const steamPath = await findSteamPath({ force: true });
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
      log.info('created cef debug flag at', flagPath);
    } catch (e) {
      log.error('could not create debug flag', e);
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

function _reset() {
  steamPathCache = null;
  steamPathAt = 0;
  runningCache = { value: false, at: 0 };
  runningInFlight = null;
}

module.exports = {
  findSteamPath,
  isSteamRunning,
  ensureDebugFlag,
  debugFlagStatus,
  FLAG_NAME,
  _reset,
};
