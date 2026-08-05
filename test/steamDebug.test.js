'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('../lib/appPaths')._setUserDataDir(fs.mkdtempSync(path.join(os.tmpdir(), 'sso-cdp-')));
const d = require('../lib/steamDebug');

test('appidFromUrl matches canonical store url', () => {
  assert.equal(d.appidFromUrl('https://store.steampowered.com/app/1091500/Cyberpunk_2077/'), '1091500');
});

test('appidFromUrl matches embedded steamloopback store url', () => {
  assert.equal(d.appidFromUrl('https://steamloopback.host/store.steampowered.com/app/730/'), '730');
});

test('appidFromUrl ignores non-store urls', () => {
  assert.equal(d.appidFromUrl('https://steamcommunity.com/discussions/'), null);
  assert.equal(d.appidFromUrl('https://store.steampowered.com/'), null);
  assert.equal(d.appidFromUrl(''), null);
  assert.equal(d.appidFromUrl(null), null);
});

test('extractGame returns first store target', () => {
  const targets = [
    { type: 'page', title: 'Steam', url: 'https://steamloopback.host/index.html' },
    { type: 'page', title: 'Dota 2 on Steam', url: 'https://store.steampowered.com/app/570/Dota_2/' },
  ];
  const g = d.extractGame(targets);
  assert.equal(g.appid, '570');
  assert.equal(g.title, 'Dota 2');
  assert.equal(g.kind, 'store');
});

test('extractGame returns null when no store target', () => {
  const targets = [{ type: 'page', title: 'Library', url: 'https://steamloopback.host/library.html' }];
  assert.equal(d.extractGame(targets), null);
});

test('cleanTitle strips " on Steam" suffix', () => {
  assert.equal(d.cleanTitle('Counter-Strike 2 on Steam'), 'Counter-Strike 2');
  assert.equal(d.cleanTitle('Just A Title'), 'Just A Title');
});

// ---- 1.0 additions -------------------------------------------------------
test('cleanTitle strips the localized connector a non-English client uses', () => {
  assert.equal(d.cleanTitle('Dota 2 no Steam'), 'Dota 2'); // pt-BR
  assert.equal(d.cleanTitle('Dota 2 en Steam'), 'Dota 2'); // es
  assert.equal(d.cleanTitle('Dota 2 su Steam'), 'Dota 2'); // it
  assert.equal(d.cleanTitle('Dota 2 sur Steam'), 'Dota 2'); // fr
  assert.equal(d.cleanTitle('Dota 2 в Steam'), 'Dota 2'); // ru
});

test('cleanTitle rejects the bare shell title', () => {
  assert.equal(d.cleanTitle('Steam'), null);
  assert.equal(d.cleanTitle('   '), null);
  assert.equal(d.cleanTitle(null), null);
});

test('libraryAppidFromUrl decodes the client tracking document', () => {
  const url =
    'data:text/html,%3Cbody%3E%3C%2Fbody%3E%3C!--tracking:dp4o52:/library/app/3354750--%3E';
  assert.equal(d.libraryAppidFromUrl(url), '3354750');
  assert.equal(d.libraryAppidFromUrl('https://steamloopback.host/index.html'), null);
  assert.equal(d.libraryAppidFromUrl(null), null);
});

test('libraryAppidFromUrl tolerates a malformed percent escape', () => {
  assert.equal(d.libraryAppidFromUrl('data:text/html,%E0%A4%A/library/app/42--'), '42');
});

test('extractGame falls back to a library page when no store page is open', () => {
  const targets = [
    { type: 'page', title: 'Steam', url: 'about:blank?createflags=274' },
    {
      type: 'page',
      title: '',
      url: 'data:text/html,%3Cbody%3E%3C%2Fbody%3E%3C!--tracking:x:/library/app/440--%3E',
    },
  ];
  const g = d.extractGame(targets);
  assert.equal(g.appid, '440');
  assert.equal(g.kind, 'library');
});

test('extractGame prefers the store page over a stale library target', () => {
  const targets = [
    {
      type: 'page',
      title: '',
      url: 'data:text/html,%3C!--tracking:x:/library/app/440--%3E',
    },
    { type: 'page', title: 'Dota 2 no Steam', url: 'https://store.steampowered.com/app/570/' },
  ];
  const g = d.extractGame(targets);
  assert.equal(g.appid, '570');
  assert.equal(g.kind, 'store');
});

test('isUsableTarget filters out devtools and non-page targets', () => {
  assert.equal(d.isUsableTarget({ type: 'page', url: 'https://x/' }), true);
  assert.equal(d.isUsableTarget({ type: 'service_worker', url: 'https://x/' }), false);
  assert.equal(d.isUsableTarget({ type: 'page', url: 'devtools://devtools/x' }), false);
  assert.equal(d.isUsableTarget({ type: 'page', url: '' }), false);
  assert.equal(d.isUsableTarget(null), false);
});
