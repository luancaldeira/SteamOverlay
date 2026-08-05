'use strict';
// Talk to Steam's CEF remote-debugging endpoint (Chrome DevTools Protocol).
// Discover the port, read /json targets, extract the open game's appid, and
// poll for changes.
//
// Two kinds of target carry an appid:
//   * the store page itself — https://store.steampowered.com/app/<id>/…
//   * a hidden tracking document the client spawns per route, whose URL embeds
//     the current library path (…<!--tracking:xxxx:/library/app/<id>-->)
// The store target wins when both exist; the library one keeps detection alive
// while the user browses games they already own.

const cache = require('./cache');
const log = require('./logger').scoped('cdp');

const DEFAULT_PORTS = [8080, 8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089, 8090];
const PROBE_TIMEOUT_MS = 1500;
const POLL_INTERVAL_MS = 1800;
const HOST = '127.0.0.1';
const PORT_CACHE_NS = 'runtime';
const PORT_CACHE_KEY = 'cdpPort';

async function fetchJson(url, timeoutMs = PROBE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Probe one port for a CDP /json endpoint (array of targets).
async function probePort(port) {
  const data = await fetchJson(`http://${HOST}:${port}/json`);
  if (Array.isArray(data)) return true;
  return false;
}

async function discoverPort(preferred) {
  const remembered = preferred || cache.getStale(PORT_CACHE_NS, PORT_CACHE_KEY);
  const ports = remembered
    ? [remembered, ...DEFAULT_PORTS.filter((p) => p !== remembered)]
    : DEFAULT_PORTS;
  for (const p of ports) {
    if (await probePort(p)) {
      cache.set(PORT_CACHE_NS, PORT_CACHE_KEY, p, { limit: 8 });
      return p;
    }
  }
  return null;
}

async function getTargets(port) {
  const data = await fetchJson(`http://${HOST}:${port}/json`);
  return Array.isArray(data) ? data : [];
}

// Pull an appid out of a store target url.
function appidFromUrl(url) {
  if (!url) return null;
  const lc = String(url).toLowerCase();
  const isStoreish =
    lc.includes('store.steampowered.com') ||
    lc.startsWith('steammobile:') ||
    lc.includes('steamloopback') ||
    lc.includes('/steamui/');
  const m = lc.match(/\/app\/(\d+)/);
  if (m && (isStoreish || lc.includes('steampowered'))) return m[1];
  // store.steampowered.com/app is the canonical case even if host check missed
  const m2 = lc.match(/store\.steampowered\.com\/app\/(\d+)/);
  return m2 ? m2[1] : null;
}

// The client's per-route tracking document. Its URL is percent-encoded, so the
// library path only appears after decoding.
function libraryAppidFromUrl(url) {
  if (!url) return null;
  const raw = String(url);
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* malformed escape — fall back to the raw string */
  }
  const m = decoded.match(/\/library\/app\/(\d+)/);
  return m ? m[1] : null;
}

function isUsableTarget(t) {
  if (!t || !t.url) return false;
  if (t.type && t.type !== 'page') return false;
  return !String(t.url).startsWith('devtools://');
}

// From the target list, find the currently open game page.
function extractGame(targets) {
  let library = null;
  for (const t of targets || []) {
    if (!isUsableTarget(t)) continue;
    const appid = appidFromUrl(t.url);
    if (appid) {
      return { appid, title: cleanTitle(t.title), url: t.url, kind: 'store' };
    }
    if (!library) {
      const libId = libraryAppidFromUrl(t.url);
      if (libId) library = { appid: libId, title: null, url: t.url, kind: 'library' };
    }
  }
  return library;
}

// Steam appends a localized " on Steam" to store tab titles ("Dota 2 no Steam"
// on a pt-BR client). Only strip a known connector word so a game genuinely
// called "<something> of Steam" survives.
const TITLE_SUFFIX_RE =
  /\s+(on|no|na|en|em|su|sur|auf|bei|op|på|paa|w|v|в|на|de|di|için|-)\s+Steam\s*$/iu;

function cleanTitle(title) {
  if (!title) return null;
  let t = String(title).trim();
  t = t.replace(TITLE_SUFFIX_RE, '');
  t = t.replace(/\s*[-–—]\s*Steam\s*$/i, '');
  t = t.trim();
  if (!t || /^steam$/i.test(t)) return null;
  return t;
}

// Polling controller. Emits via callbacks:
//   onGame(game|null)   game = {appid,title,url,kind}; null when no game page open
//   onStatus({connected, port})
function createPoller({ intervalMs = POLL_INTERVAL_MS, onGame, onStatus } = {}) {
  let port = null;
  let timer = null;
  let lastKey = undefined; // undefined = never reported
  let running = false;

  async function tick() {
    if (!running) return;
    try {
      if (port == null) {
        port = await discoverPort(port);
        if (onStatus) onStatus({ connected: port != null, port });
      }
      if (port == null) {
        report(null);
        return;
      }
      const targets = await getTargets(port);
      if (targets.length === 0) {
        // endpoint likely gone — force rediscovery next tick
        const stillUp = await probePort(port);
        if (!stillUp) {
          log.info('cdp endpoint lost on port', port);
          port = null;
          if (onStatus) onStatus({ connected: false, port: null });
          report(null);
          return;
        }
      }
      const game = extractGame(targets);
      report(game);
    } catch (e) {
      log.debug('poll tick failed', e);
      report(null);
    }
  }

  // Key on kind too: switching from the store page to the library page for the
  // same appid is a real change of source the UI should reflect.
  function report(game) {
    const key = game ? `${game.kind}:${game.appid}` : null;
    if (key !== lastKey) {
      lastKey = key;
      if (onGame) onGame(game);
    }
  }

  function start() {
    if (running) return;
    running = true;
    tick();
    timer = setInterval(tick, intervalMs);
  }

  function stop() {
    running = false;
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, getPort: () => port };
}

module.exports = {
  discoverPort,
  probePort,
  getTargets,
  appidFromUrl,
  libraryAppidFromUrl,
  extractGame,
  isUsableTarget,
  cleanTitle,
  createPoller,
  DEFAULT_PORTS,
};
