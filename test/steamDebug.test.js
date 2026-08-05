'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
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
});

test('extractGame returns null when no store target', () => {
  const targets = [{ type: 'page', title: 'Library', url: 'https://steamloopback.host/library.html' }];
  assert.equal(d.extractGame(targets), null);
});

test('cleanTitle strips " on Steam" suffix', () => {
  assert.equal(d.cleanTitle('Counter-Strike 2 on Steam'), 'Counter-Strike 2');
  assert.equal(d.cleanTitle('Just A Title'), 'Just A Title');
});
