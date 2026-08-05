'use strict';
// Fetch a Steam store page by appid and parse the Windows system requirements
// (minimum + recommended). Results cached in memory by appid.

const cheerio = require('cheerio');

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const FETCH_TIMEOUT_MS = 12000;
const cache = new Map(); // appid -> { ts, data }

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const AGE_COOKIE =
  'birthtime=628560001; mature_content=1; lastagecheckage=1-January-1990; wants_mature_content=1';

// label (lowercased, no colon) -> normalized field
const LABEL_MAP = [
  [/^(processor|cpu)/, 'cpu'],
  [/^(graphics|video card|graphics card|gpu)/, 'gpu'],
  [/^(memory|ram)/, 'ram'],
  [/^(os|operating system)/, 'os'],
  [/^(storage|hard drive|hard disk|available space|additional storage)/, 'storage'],
  [/^directx/, 'directx'],
];

function fieldForLabel(label) {
  const l = label.toLowerCase().replace(/:\s*$/, '').trim();
  for (const [re, field] of LABEL_MAP) if (re.test(l)) return field;
  return null;
}

function parseUl($, ul) {
  const block = {};
  $(ul)
    .find('li')
    .each((_, li) => {
      const $li = $(li);
      const strong = $li.find('strong').first();
      const label = strong.text().trim();
      // value = full li text minus the strong label
      let value = $li.text().trim();
      if (label && value.startsWith(label)) value = value.slice(label.length).trim();
      value = value.replace(/^[:\-\s]+/, '').trim();
      if (!label || !value) return; // header rows like "Minimum:" have no value
      const field = fieldForLabel(label);
      if (field && !block[field]) block[field] = value;
    });
  return block;
}

function hasAny(block) {
  return block && Object.keys(block).length > 0;
}

function parseRequirementsHtml(html) {
  const $ = cheerio.load(html);
  // Prefer the Windows requirements container
  let $win = $('.game_area_sys_req[data-os="win"]');
  if ($win.length === 0) {
    // Windows-only games can have a single block with NO data-os attribute.
    // Never fall back to a mac/linux block — that would mislabel non-Windows
    // specs as Windows requirements.
    $win = $('.game_area_sys_req')
      .filter((_, el) => !$(el).attr('data-os'))
      .first();
  }
  if ($win.length === 0) return { available: false, minimum: null, recommended: null };

  const leftUl = $win.find('.game_area_sys_req_leftCol ul').first();
  const rightUl = $win.find('.game_area_sys_req_rightCol ul').first();

  let minimum = null;
  let recommended = null;

  if (leftUl.length || rightUl.length) {
    if (leftUl.length) minimum = parseUl($, leftUl);
    if (rightUl.length) recommended = parseUl($, rightUl);
  } else {
    // single-column: the whole block is the minimum spec
    const ul = $win.find('ul').first();
    if (ul.length) minimum = parseUl($, ul);
  }

  const available = hasAny(minimum) || hasAny(recommended);
  if (!hasAny(minimum)) minimum = null;
  if (!hasAny(recommended)) recommended = null;
  return { available, minimum, recommended };
}

async function fetchStoreHtml(appid) {
  const url = `https://store.steampowered.com/app/${appid}/?l=english`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        Cookie: AGE_COOKIE,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Returns { available, minimum, recommended, appid, cached } or throws on network error.
async function getRequirements(appid, { force = false } = {}) {
  appid = String(appid);
  const now = Date.now();
  const hit = cache.get(appid);
  if (!force && hit && now - hit.ts < CACHE_TTL_MS) {
    return { ...hit.data, appid, cached: true };
  }
  const html = await fetchStoreHtml(appid);
  const parsed = parseRequirementsHtml(html);
  cache.set(appid, { ts: now, data: parsed });
  return { ...parsed, appid, cached: false };
}

function _clearCache() {
  cache.clear();
}

module.exports = { getRequirements, parseRequirementsHtml, fieldForLabel, _clearCache };
