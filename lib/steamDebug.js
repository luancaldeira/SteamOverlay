'use strict';
// Talk to Steam's CEF remote-debugging endpoint (Chrome DevTools Protocol).
// Discover the port, read /json targets, extract the open game's appid, and
// poll for changes.

const DEFAULT_PORTS = [8080, 8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089, 8090];
const PROBE_TIMEOUT_MS = 1500;
const POLL_INTERVAL_MS = 1800;
const HOST = '127.0.0.1';

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
  const ports = preferred ? [preferred, ...DEFAULT_PORTS.filter((p) => p !== preferred)] : DEFAULT_PORTS;
  for (const p of ports) {
    if (await probePort(p)) return p;
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

// From the target list, find the currently open game page.
function extractGame(targets) {
  for (const t of targets || []) {
    const appid = appidFromUrl(t.url);
    if (appid) {
      return { appid, title: cleanTitle(t.title), url: t.url };
    }
  }
  return null;
}

function cleanTitle(title) {
  if (!title) return null;
  // Steam store tab titles are often "Game Name on Steam"
  return String(title)
    .replace(/\s+on Steam\s*$/i, '')
    .trim() || null;
}

// Polling controller. Emits via callbacks:
//   onGame(game|null)   game = {appid,title,url}; null when no game page open
//   onStatus({connected, port, mode})
function createPoller({ intervalMs = POLL_INTERVAL_MS, onGame, onStatus } = {}) {
  let port = null;
  let timer = null;
  let lastAppid = undefined; // undefined = never reported
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
          port = null;
          if (onStatus) onStatus({ connected: false, port: null });
          report(null);
          return;
        }
      }
      const game = extractGame(targets);
      report(game);
    } catch {
      report(null);
    }
  }

  function report(game) {
    const appid = game ? game.appid : null;
    if (appid !== lastAppid) {
      lastAppid = appid;
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
  extractGame,
  cleanTitle,
  createPoller,
  DEFAULT_PORTS,
};
