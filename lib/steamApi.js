'use strict';
// Single source of truth for "what does app N require, and what is it called".
//
// Primary source is Steam's official appdetails endpoint: ~5 KB of JSON that
// carries the localized-independent name, the header artwork and the very same
// requirement <ul> markup the store page renders. The full store page is kept
// only as a fallback for the appids the API refuses (delisted, region-locked).
//
// Everything is cached to disk. On a network failure we deliberately serve a
// stale entry rather than an error — a day-old requirement block is still a
// correct requirement block.

const scraper = require('./steamScraper');
const cache = require('./cache');
const log = require('./logger').scoped('api');

const API_TIMEOUT_MS = 10000;
const ART_TIMEOUT_MS = 8000;
const TTL_MS = 12 * 60 * 60 * 1000; // 12h
const RETRIES = 2;
const RETRY_DELAY_MS = 700;

const NS_REQS = 'requirements';
const NS_ART = 'artwork';

function err(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url, { timeout = API_TIMEOUT_MS, headers } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'follow', headers });
  } finally {
    clearTimeout(timer);
  }
}

// `pc_requirements` is an object normally, but Steam returns `[]` for apps that
// have none at all.
function reqField(pc, key) {
  if (!pc || Array.isArray(pc)) return null;
  const v = pc[key];
  return typeof v === 'string' && v.trim() ? v : null;
}

async function fetchAppDetails(appid) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(
    appid
  )}&l=english&cc=us`;
  const res = await fetchWithTimeout(url, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
  if (!res.ok) throw err('network', `appdetails HTTP ${res.status}`);
  const json = await res.json();
  const entry = json && json[String(appid)];
  if (!entry || !entry.success || !entry.data) return null; // API knows nothing usable
  return entry.data;
}

function fromAppDetails(data, appid) {
  const pc = data.pc_requirements;
  const minimum = scraper.parseRequirementsFragment(reqField(pc, 'minimum'));
  const recommended = scraper.parseRequirementsFragment(reqField(pc, 'recommended'));
  const windows = !data.platforms || data.platforms.windows !== false;
  return {
    appid: String(appid),
    name: data.name || null,
    type: data.type || null,
    headerImage: data.header_image || null,
    windows,
    available: !!(minimum || recommended),
    minimum,
    recommended,
    source: 'api',
  };
}

async function resolve(appid) {
  let apiError = null;
  try {
    const data = await fetchAppDetails(appid);
    if (data) {
      const info = fromAppDetails(data, appid);
      if (info.available) return info;
      // API answered but carries no PC requirements — the store page sometimes
      // still has them (older listings). Try it, keeping the good name/art.
      try {
        const page = await scraper.scrapeStorePage(appid);
        if (page.available) {
          return { ...info, ...page, name: info.name || page.title, source: 'store-page' };
        }
      } catch (e) {
        log.debug('store-page fallback failed', e);
      }
      return info; // genuinely no PC requirements
    }
  } catch (e) {
    apiError = e;
    log.warn('appdetails failed for', String(appid), e);
  }

  // API unusable — full page scrape.
  try {
    const page = await scraper.scrapeStorePage(appid);
    return {
      appid: String(appid),
      name: page.title || null,
      type: null,
      headerImage: null,
      windows: true,
      available: page.available,
      minimum: page.minimum,
      recommended: page.recommended,
      source: 'store-page',
    };
  } catch (e) {
    throw apiError || err('network', e.message);
  }
}

// Returns { …info, cached, stale }. Throws only when there is nothing at all —
// no fresh fetch, no cached copy.
async function getGameInfo(appid, { force = false } = {}) {
  const key = String(appid);
  if (!force) {
    const hit = cache.get(NS_REQS, key, TTL_MS);
    if (hit) return { ...hit, cached: true, stale: false };
  }

  let lastErr = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const info = await resolve(key);
      cache.set(NS_REQS, key, info, { limit: 400 });
      return { ...info, cached: false, stale: false };
    } catch (e) {
      lastErr = e;
      if (attempt < RETRIES) await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  const stale = cache.getStale(NS_REQS, key);
  if (stale) {
    log.info('serving stale requirements for', key);
    return { ...stale, cached: true, stale: true };
  }
  throw lastErr || err('network', 'unreachable');
}

// Header artwork as a data: URL so the renderer CSP can stay at `img-src 'self' data:`.
async function getArtwork(url) {
  if (!url) return null;
  const key = url.split('?')[0];
  const hit = cache.get(NS_ART, key, 30 * 24 * 60 * 60 * 1000);
  if (hit) return hit;
  try {
    const res = await fetchWithTimeout(url, { timeout: ART_TIMEOUT_MS });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 512 * 1024) return null; // header images are ~40 KB; anything huge is wrong
    const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
    if (!/^image\//.test(mime)) return null;
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
    cache.set(NS_ART, key, dataUrl, { limit: 60 });
    return dataUrl;
  } catch (e) {
    log.debug('artwork fetch failed', e);
    return null;
  }
}

module.exports = { getGameInfo, getArtwork, fetchAppDetails, fromAppDetails, TTL_MS };
