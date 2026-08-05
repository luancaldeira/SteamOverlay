'use strict';
// User settings persisted to userData. Every value is validated on read, so a
// hand-edited or truncated file can never put the overlay in a state the user
// cannot recover from (e.g. opacity 0, or a window parked off-screen).

const { readJson, writeJson } = require('./jsonFile');
const { dataFile } = require('./appPaths');

const DEFAULTS = {
  version: 1,
  x: null, // null = compute default corner position
  y: null,
  opacity: 1,
  alwaysOnTop: true,
  clickThrough: false,
  reqType: 'recommended', // which block the overlay opens on
  autoStart: false,
  showArtwork: true,
  compact: false,
  logLevel: 'info',
};

const MIN_OPACITY = 0.35;

function clampNum(v, lo, hi, fallback) {
  const n = Number(v);
  if (!isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function bool(v, fallback) {
  return typeof v === 'boolean' ? v : fallback;
}

// "not set yet" must stay null. Number(null) is 0, so a naive isFinite check
// would silently pin an unpositioned window to the top-left of the screen the
// first time any other setting changed.
function coord(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function sanitize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    version: 1,
    x: coord(r.x),
    y: coord(r.y),
    opacity: clampNum(r.opacity, MIN_OPACITY, 1, DEFAULTS.opacity),
    alwaysOnTop: bool(r.alwaysOnTop, DEFAULTS.alwaysOnTop),
    clickThrough: bool(r.clickThrough, DEFAULTS.clickThrough),
    reqType: r.reqType === 'minimum' ? 'minimum' : 'recommended',
    autoStart: bool(r.autoStart, DEFAULTS.autoStart),
    showArtwork: bool(r.showArtwork, DEFAULTS.showArtwork),
    compact: bool(r.compact, DEFAULTS.compact),
    logLevel: ['error', 'warn', 'info', 'debug'].includes(r.logLevel) ? r.logLevel : DEFAULTS.logLevel,
  };
}

let current = null;
let file = null;
let saveTimer = null;
const listeners = new Set();

function path_() {
  if (!file) file = dataFile('settings.json');
  return file;
}

function all() {
  if (!current) current = sanitize(readJson(path_(), null));
  return { ...current };
}

function get(key) {
  return all()[key];
}

function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (current) writeJson(path_(), current);
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (current) writeJson(path_(), current);
  }, 300);
  if (saveTimer.unref) saveTimer.unref();
}

// Returns the patch that actually changed, so callers can skip no-op work
// (re-registering shortcuts, re-applying window flags).
function patch(changes) {
  const before = all();
  const next = sanitize({ ...before, ...changes });
  const changed = {};
  for (const k of Object.keys(next)) {
    if (next[k] !== before[k]) changed[k] = next[k];
  }
  current = next;
  if (Object.keys(changed).length === 0) return changed;
  scheduleSave();
  for (const fn of listeners) {
    try {
      fn(changed, next);
    } catch {
      /* a bad listener must not break persistence */
    }
  }
  return changed;
}

function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function _reset() {
  current = null;
  file = null;
  listeners.clear();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
}

module.exports = { all, get, patch, onChange, flush, sanitize, DEFAULTS, MIN_OPACITY, _reset };
