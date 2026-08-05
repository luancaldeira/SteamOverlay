'use strict';
// Network is stubbed: these assert the decision tree (API -> store page -> stale
// cache), not Steam's availability.
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sso-api-'));
require('../lib/appPaths')._setUserDataDir(tmp);

const cache = require('../lib/cache');
const api = require('../lib/steamApi');

const realFetch = globalThis.fetch;

function jsonRes(body) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function htmlRes(html) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'text/html' },
    text: async () => html,
    json: async () => {
      throw new Error('not json');
    },
  };
}

const REQ_FRAGMENT =
  '<strong>Minimum:</strong><br><ul class="bb_ul">' +
  '<li><strong>OS:</strong> Windows 10<br></li>' +
  '<li><strong>Processor:</strong> Core i5-9400<br></li>' +
  '<li><strong>Memory:</strong> 8 GB RAM<br></li>' +
  '<li><strong>Graphics:</strong> GeForce GTX 1060</li></ul>';

const REC_FRAGMENT =
  '<strong>Recommended:</strong><br><ul class="bb_ul">' +
  '<li><strong>Processor:</strong> Core i7-9700K<br></li>' +
  '<li><strong>Memory:</strong> 16 GB RAM<br></li>' +
  '<li><strong>Graphics:</strong> GeForce RTX 3070</li></ul>';

beforeEach(() => {
  cache._reset();
  for (const f of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, f), { force: true });
});

after(() => {
  globalThis.fetch = realFetch;
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

test('appdetails is the primary source and both blocks are parsed', async () => {
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes('/api/appdetails'), 'should hit the API first');
    return jsonRes({
      '111': {
        success: true,
        data: {
          name: 'Test Game',
          type: 'game',
          header_image: 'https://cdn/header.jpg',
          platforms: { windows: true },
          pc_requirements: { minimum: REQ_FRAGMENT, recommended: REC_FRAGMENT },
        },
      },
    });
  };
  const info = await api.getGameInfo('111');
  assert.equal(info.source, 'api');
  assert.equal(info.name, 'Test Game');
  assert.equal(info.available, true);
  assert.equal(info.minimum.cpu, 'Core i5-9400');
  assert.equal(info.recommended.gpu, 'GeForce RTX 3070');
  assert.equal(info.headerImage, 'https://cdn/header.jpg');
});

test('a second lookup is served from cache without touching the network', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return jsonRes({
      '222': {
        success: true,
        data: { name: 'Cached', platforms: { windows: true }, pc_requirements: { minimum: REQ_FRAGMENT } },
      },
    });
  };
  await api.getGameInfo('222');
  const second = await api.getGameInfo('222');
  assert.equal(calls, 1);
  assert.equal(second.cached, true);
  assert.equal(second.name, 'Cached');
});

test('falls back to the store page when the API disowns the appid', async () => {
  let sawPage = false;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/appdetails')) return jsonRes({ '333': { success: false } });
    sawPage = true;
    return htmlRes(
      '<div id="appHubAppName">Legacy Game</div>' +
        '<div class="game_area_sys_req" data-os="win"><ul>' +
        '<li><strong>Processor:</strong> Core i7-6700</li>' +
        '<li><strong>Memory:</strong> 8 GB RAM</li></ul></div>'
    );
  };
  const info = await api.getGameInfo('333');
  assert.ok(sawPage, 'store page should have been fetched');
  assert.equal(info.source, 'store-page');
  assert.equal(info.name, 'Legacy Game');
  assert.equal(info.minimum.cpu, 'Core i7-6700');
});

test('pc_requirements as an empty array means no PC requirements', async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/appdetails')) {
      return jsonRes({
        '444': { success: true, data: { name: 'Console Only', platforms: { windows: false }, pc_requirements: [] } },
      });
    }
    throw new Error('offline');
  };
  const info = await api.getGameInfo('444');
  assert.equal(info.available, false);
  assert.equal(info.name, 'Console Only');
  assert.equal(info.windows, false);
});

test('a stale cache entry beats an error when the network dies', async () => {
  globalThis.fetch = async () =>
    jsonRes({
      '555': {
        success: true,
        data: { name: 'Offline Later', platforms: { windows: true }, pc_requirements: { minimum: REQ_FRAGMENT } },
      },
    });
  await api.getGameInfo('555');

  globalThis.fetch = async () => {
    throw new Error('ENOTFOUND');
  };
  const info = await api.getGameInfo('555', { force: true });
  assert.equal(info.stale, true);
  assert.equal(info.name, 'Offline Later');
  assert.equal(info.minimum.cpu, 'Core i5-9400');
});

test('with neither network nor cache the caller gets an error', async () => {
  globalThis.fetch = async () => {
    throw new Error('ENOTFOUND');
  };
  await assert.rejects(() => api.getGameInfo('666'));
});

test('artwork is returned as a data URL and cached', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    };
  };
  const first = await api.getArtwork('https://cdn/header.jpg?t=1');
  assert.ok(first.startsWith('data:image/jpeg;base64,'), first);
  const second = await api.getArtwork('https://cdn/header.jpg?t=2'); // query ignored in the key
  assert.equal(second, first);
  assert.equal(calls, 1);
});

test('artwork failures degrade to null rather than throwing', async () => {
  globalThis.fetch = async () => {
    throw new Error('ECONNRESET');
  };
  assert.equal(await api.getArtwork('https://cdn/other.jpg'), null);
  assert.equal(await api.getArtwork(null), null);
});
