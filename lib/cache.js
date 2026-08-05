'use strict';
// Namespaced disk cache (userData). Requirements, artwork and detected specs
// survive a restart, so a relaunch paints instantly and a page you already
// looked at still works with no network.
//
// Entries carry a timestamp; `get` honours the TTL, `getStale` ignores it so a
// network failure can fall back to yesterday's answer instead of an error.

const { readJson, writeJson } = require('./jsonFile');
const { dataFile } = require('./appPaths');

const FLUSH_DELAY_MS = 400;
const namespaces = new Map(); // name -> { file, data, limit, dirty, timer }

function ns(name, { limit = 200 } = {}) {
  let entry = namespaces.get(name);
  if (entry) return entry;
  const file = dataFile(`cache-${name}.json`);
  entry = { file, data: readJson(file, {}) || {}, limit, timer: null };
  namespaces.set(name, entry);
  return entry;
}

function scheduleFlush(entry) {
  if (entry.timer) return;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    flushEntry(entry);
  }, FLUSH_DELAY_MS);
  if (entry.timer.unref) entry.timer.unref();
}

// Drop the oldest entries once a namespace passes its limit. Artwork is the
// only bulky namespace and 60 covers vastly exceeds normal browsing.
function evict(entry) {
  const keys = Object.keys(entry.data);
  if (keys.length <= entry.limit) return;
  keys
    .map((k) => [k, entry.data[k] && entry.data[k].ts ? entry.data[k].ts : 0])
    .sort((a, b) => a[1] - b[1])
    .slice(0, keys.length - entry.limit)
    .forEach(([k]) => delete entry.data[k]);
}

function flushEntry(entry) {
  evict(entry);
  writeJson(entry.file, entry.data);
}

function get(name, key, ttlMs) {
  const entry = ns(name);
  const hit = entry.data[String(key)];
  if (!hit) return null;
  if (ttlMs != null && Date.now() - hit.ts > ttlMs) return null;
  return hit.value;
}

function getStale(name, key) {
  const hit = ns(name).data[String(key)];
  return hit ? hit.value : null;
}

function set(name, key, value, opts) {
  const entry = ns(name, opts);
  entry.data[String(key)] = { ts: Date.now(), value };
  scheduleFlush(entry);
  return value;
}

function has(name, key) {
  return Object.prototype.hasOwnProperty.call(ns(name).data, String(key));
}

function flush() {
  for (const entry of namespaces.values()) {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    flushEntry(entry);
  }
}

function _reset() {
  for (const entry of namespaces.values()) if (entry.timer) clearTimeout(entry.timer);
  namespaces.clear();
}

module.exports = { get, getStale, set, has, flush, _reset };
