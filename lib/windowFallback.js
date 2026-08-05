'use strict';
// Plan B: when CDP is unavailable, read Steam's window titles and try to resolve
// a game name -> appid through Steam's search endpoint.
//
// Modern Steam clients keep the window title at a plain "Steam", so this rarely
// fires — which is exactly why it must be cheap. The previous implementation
// compiled a C# P/Invoke shim through PowerShell on every tick; this one reads
// the title column `tasklist` already prints, parsed positionally so it works on
// a localized Windows where the column headers are translated.

const { execFile } = require('child_process');
const log = require('./logger').scoped('fallback');

const IMAGES = ['steamwebhelper.exe', 'steam.exe'];
const EXEC_TIMEOUT_MS = 5000;
const SEARCH_TIMEOUT_MS = 6000;

// Placeholder titles every locale uses for "this process has no window".
const EMPTY_TITLE_RE = /^(n\/a|sem t[ií]tulo|untitled|sin t[ií]tulo|ohne titel|sans titre|senza titolo|无标题|steam)$/i;

function parseCsvLine(line) {
  const out = [];
  const re = /"((?:[^"]|"")*)"/g;
  let m;
  while ((m = re.exec(line)) !== null) out.push(m[1].replace(/""/g, '"'));
  return out;
}

function titlesFromTasklist(stdout) {
  const titles = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (cols.length < 2) continue;
    const title = (cols[cols.length - 1] || '').trim(); // last column = window title
    if (!title || EMPTY_TITLE_RE.test(title)) continue;
    titles.push(title);
  }
  return titles;
}

function listTitles(image) {
  return new Promise((resolve) => {
    execFile(
      'tasklist',
      ['/V', '/FO', 'CSV', '/NH', '/FI', `IMAGENAME eq ${image}`],
      { windowsHide: true, timeout: EXEC_TIMEOUT_MS, maxBuffer: 1024 * 512 },
      (err, stdout) => {
        if (err || !stdout) return resolve([]);
        resolve(titlesFromTasklist(stdout));
      }
    );
  });
}

async function getSteamWindowTitles() {
  for (const image of IMAGES) {
    const titles = await listTitles(image);
    if (titles.length) return titles;
  }
  return [];
}

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Steam's search is fuzzy and will happily return *something* for any string.
// Only accept a hit whose name actually corresponds to what we searched for,
// otherwise the overlay would confidently show the wrong game.
function isPlausibleMatch(query, name) {
  const q = normalizeName(query);
  const n = normalizeName(name);
  if (!q || !n) return false;
  return q === n || q.startsWith(n) || n.startsWith(q);
}

async function searchAppid(name) {
  if (!name) return null;
  try {
    const url = `https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(name)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr)) return null;
    for (const hit of arr) {
      if (hit && hit.appid && isPlausibleMatch(name, hit.name)) {
        return { appid: String(hit.appid), name: hit.name || name };
      }
    }
  } catch (e) {
    log.debug('app search failed', e);
  }
  return null;
}

// Best-effort guess of the game the user is viewing in Steam.
// Returns { appid, title } or null.
async function getFallbackGame() {
  const titles = await getSteamWindowTitles();
  for (const title of titles) {
    const hit = await searchAppid(title);
    if (hit) return { appid: hit.appid, title: hit.name };
  }
  return null;
}

module.exports = {
  getSteamWindowTitles,
  titlesFromTasklist,
  parseCsvLine,
  isPlausibleMatch,
  searchAppid,
  getFallbackGame,
};
