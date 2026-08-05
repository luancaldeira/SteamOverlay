'use strict';
// settings + cache: both write to userData, so both are pointed at a temp dir.
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sso-store-'));
require('../lib/appPaths')._setUserDataDir(tmp);

const settings = require('../lib/settings');
const cache = require('../lib/cache');
const { readJson, writeJson } = require('../lib/jsonFile');

after(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

// ---- jsonFile ------------------------------------------------------------
test('readJson degrades to the fallback on missing or corrupt files', () => {
  assert.deepEqual(readJson(path.join(tmp, 'nope.json'), { a: 1 }), { a: 1 });
  const bad = path.join(tmp, 'bad.json');
  fs.writeFileSync(bad, '{ this is not json');
  assert.equal(readJson(bad, null), null);
  fs.writeFileSync(bad, '');
  assert.deepEqual(readJson(bad, { b: 2 }), { b: 2 });
});

test('writeJson leaves no temp file behind', () => {
  const file = path.join(tmp, 'ok.json');
  assert.equal(writeJson(file, { x: 1 }), true);
  assert.deepEqual(readJson(file, null), { x: 1 });
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

// ---- settings ------------------------------------------------------------
test('sanitize clamps every field into a usable range', () => {
  const s = settings.sanitize({
    opacity: 0,
    reqType: 'garbage',
    alwaysOnTop: 'yes',
    logLevel: 'shout',
    x: 'abc',
  });
  assert.ok(s.opacity >= settings.MIN_OPACITY, 'an invisible window must not be reachable');
  assert.equal(s.reqType, 'recommended');
  assert.equal(s.alwaysOnTop, true);
  assert.equal(s.logLevel, 'info');
  assert.equal(s.x, null);
});

test('sanitize caps opacity at 1 and keeps valid coordinates', () => {
  const s = settings.sanitize({ opacity: 5, x: 100.6, y: -30 });
  assert.equal(s.opacity, 1);
  assert.equal(s.x, 101);
  assert.equal(s.y, -30); // negative is legitimate on a left-hand second monitor
});

test('patch reports only what actually changed', () => {
  settings._reset();
  const first = settings.patch({ compact: true });
  assert.deepEqual(Object.keys(first), ['compact']);
  const second = settings.patch({ compact: true });
  assert.deepEqual(second, {}, 'a no-op patch must report no changes');
});

test('onChange fires with the changed subset and the full state', () => {
  settings._reset();
  let seen = null;
  const off = settings.onChange((changed, all) => {
    seen = { changed, all };
  });
  settings.patch({ opacity: 0.5 });
  assert.deepEqual(seen.changed, { opacity: 0.5 });
  assert.equal(seen.all.opacity, 0.5);
  off();
  settings.patch({ opacity: 0.6 });
  assert.equal(seen.changed.opacity, 0.5, 'unsubscribed listener should not fire again');
});

test('a throwing listener does not break persistence', () => {
  settings._reset();
  settings.onChange(() => {
    throw new Error('boom');
  });
  settings.patch({ compact: true });
  settings.flush();
  settings._reset();
  assert.equal(settings.all().compact, true);
});

// ---- cache ---------------------------------------------------------------
test('cache honours TTL, survives a flush, and can read stale', () => {
  cache._reset();
  cache.set('t1', 'a', { v: 1 });
  assert.deepEqual(cache.get('t1', 'a', 60000), { v: 1 });
  assert.equal(cache.get('t1', 'a', -1), null, 'expired entry must not be returned');
  assert.deepEqual(cache.getStale('t1', 'a'), { v: 1 });
  cache.flush();
  cache._reset();
  assert.deepEqual(cache.get('t1', 'a', 60000), { v: 1 });
});

test('cache evicts the oldest entries past the limit', () => {
  cache._reset();
  for (let i = 0; i < 8; i++) cache.set('t2', `k${i}`, i, { limit: 3 });
  cache.flush();
  const raw = readJson(path.join(tmp, 'cache-t2.json'), {});
  assert.equal(Object.keys(raw).length, 3);
  assert.ok('k7' in raw, 'the newest entry must survive eviction');
});

test('cache reports misses for unknown keys', () => {
  cache._reset();
  assert.equal(cache.get('t3', 'missing', 1000), null);
  assert.equal(cache.getStale('t3', 'missing'), null);
  assert.equal(cache.has('t3', 'missing'), false);
});
