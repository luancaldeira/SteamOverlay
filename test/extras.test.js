'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const e = require('../lib/extras');

test('parseWindowsVersion takes the lowest accepted version', () => {
  assert.equal(e.parseWindowsVersion('Windows 7/8/10'), 7);
  assert.equal(e.parseWindowsVersion('64-bit Windows 10'), 10);
  assert.equal(e.parseWindowsVersion('Windows 11'), 11);
  assert.equal(e.parseWindowsVersion('Windows 8.1 64-bit'), 8.1);
  assert.equal(e.parseWindowsVersion('Windows XP'), 5.1);
  assert.equal(e.parseWindowsVersion('Ubuntu 20.04'), null);
  assert.equal(e.parseWindowsVersion(null), null);
});

test('parseDirectX only accepts plausible versions', () => {
  assert.equal(e.parseDirectX('Version 12'), 12);
  assert.equal(e.parseDirectX('DirectX 11'), 11);
  assert.equal(e.parseDirectX('Versão 9.0c'), 9);
  assert.equal(e.parseDirectX('n/a'), null);
});

test('parseStorageGB normalizes units', () => {
  assert.equal(e.parseStorageGB('70 GB available space'), 70);
  assert.equal(e.parseStorageGB('512 MB'), 0.5);
  assert.equal(e.parseStorageGB('1 TB'), 1024);
  assert.equal(e.parseStorageGB('lots of space'), null);
});

const specs = { windowsVersion: 11, directX: 12, arch: 'x64', freeDiskGB: 200 };

test('buildExtras passes a machine that clears every bar', () => {
  const chips = e.buildExtras(
    { os: '64-bit Windows 10', directx: 'Version 12', storage: '70 GB available space', requires64: true },
    specs
  );
  assert.equal(chips.length, 4);
  assert.ok(chips.every((c) => c.ok === true));
  assert.deepEqual(chips.map((c) => c.key), ['os', 'directx', 'storage', 'arch']);
});

test('buildExtras fails the bars the machine misses', () => {
  const chips = e.buildExtras({ os: 'Windows 11', storage: '500 GB' }, { ...specs, windowsVersion: 10, freeDiskGB: 40 });
  assert.equal(chips.find((c) => c.key === 'os').ok, false);
  assert.equal(chips.find((c) => c.key === 'storage').ok, false);
});

test('buildExtras reports unknown rather than failing when the spec is missing', () => {
  const chips = e.buildExtras({ os: 'Windows 10', storage: '70 GB' }, {});
  assert.equal(chips.find((c) => c.key === 'os').ok, null);
  assert.equal(chips.find((c) => c.key === 'storage').ok, null);
});

test('buildExtras emits nothing for a block with no extra fields', () => {
  assert.deepEqual(e.buildExtras({ cpu: 'Core i5-9400' }, specs), []);
  assert.deepEqual(e.buildExtras(null, null), []);
});

test('DirectX is flagged soft because the GPU feature level is the real gate', () => {
  const chips = e.buildExtras({ directx: 'Version 12' }, specs);
  assert.equal(chips[0].soft, true);
});
