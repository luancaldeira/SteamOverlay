'use strict';
// Parsing of Steam system-requirement markup, plus the store-page fetch used as
// a fallback when the appdetails API has nothing. Caching lives in steamApi.js
// so there is exactly one place that decides what is fresh.
//
// Two shapes are parsed:
//   - a full store page (`.game_area_sys_req` blocks, with data-os)
//   - an appdetails fragment ("<strong>Minimum:</strong><br><ul>…</ul>")

const cheerio = require('cheerio');

const FETCH_TIMEOUT_MS = 12000;

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
  [/^(sound|sound card)/, 'sound'],
  [/^(network|internet)/, 'network'],
  [/^additional notes/, 'notes'],
];

// Fields that make a block worth showing. `notes`/`sound`/`network` alone is not
// a requirement block — it must not flip `available` to true on its own.
const MEANINGFUL = ['cpu', 'gpu', 'ram', 'os', 'storage', 'directx'];

function fieldForLabel(label) {
  const l = label.toLowerCase().replace(/:\s*$/, '').trim();
  for (const [re, field] of LABEL_MAP) if (re.test(l)) return field;
  return null;
}

function parseUl($, ul) {
  const block = {};
  const loose = [];
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
      if (!label) {
        // Un-labelled lines carry real signal ("Requires a 64-bit processor…")
        if (value) loose.push(value);
        return;
      }
      if (!value) return; // header rows like "Minimum:" have no value
      const field = fieldForLabel(label);
      if (field && !block[field]) block[field] = value;
    });
  if (loose.length) block.extra = loose.join(' · ');
  const all = [...loose, block.os || '', block.notes || ''].join(' ');
  if (/64[\s-]?bit/i.test(all)) block.requires64 = true;
  return block;
}

function hasAny(block) {
  return !!block && MEANINGFUL.some((f) => block[f]);
}

function normalizeBlock(block) {
  return hasAny(block) ? block : null;
}

// Parse one appdetails `pc_requirements.minimum` / `.recommended` fragment.
function parseRequirementsFragment(html) {
  if (!html || typeof html !== 'string') return null;
  const $ = cheerio.load(html);
  const ul = $('ul').first();
  if (ul.length === 0) return null;
  return normalizeBlock(parseUl($, ul));
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

  minimum = normalizeBlock(minimum);
  recommended = normalizeBlock(recommended);
  return { available: !!(minimum || recommended), minimum, recommended };
}

// Pull the display name out of a store page as a last resort (the API path
// normally supplies a better one).
function parseTitleFromHtml(html) {
  try {
    const $ = cheerio.load(html);
    const t = $('#appHubAppName').first().text().trim();
    return t || null;
  } catch {
    return null;
  }
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

// Store-page fallback. Throws on network failure; returns `available:false`
// when the page simply has no Windows requirement block.
async function scrapeStorePage(appid) {
  const html = await fetchStoreHtml(appid);
  const parsed = parseRequirementsHtml(html);
  return { ...parsed, title: parseTitleFromHtml(html), source: 'store-page' };
}

module.exports = {
  parseRequirementsHtml,
  parseRequirementsFragment,
  parseTitleFromHtml,
  fieldForLabel,
  fetchStoreHtml,
  scrapeStorePage,
  hasAny,
};
