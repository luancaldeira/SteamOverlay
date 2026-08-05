'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('../lib/appPaths')._setUserDataDir(fs.mkdtempSync(path.join(os.tmpdir(), 'sso-specs-')));
const d = require('../lib/detectSpecs');

test('pickGpu prefers a dedicated card over the integrated one', () => {
  const g = d.pickGpu([
    { vendor: 'Intel', model: 'UHD Graphics 630', vram: 128 },
    { vendor: 'NVIDIA', model: 'GeForce RTX 3070', vram: 8192 },
  ]);
  assert.equal(g.model, 'GeForce RTX 3070');
  assert.equal(g.vramMB, 8192);
});

test('pickGpu prefers the larger card when both are dedicated', () => {
  const g = d.pickGpu([
    { vendor: 'NVIDIA', model: 'GeForce GTX 1050 Ti', vram: 4096 },
    { vendor: 'NVIDIA', model: 'GeForce RTX 3070', vram: 8192 },
  ]);
  assert.equal(g.model, 'GeForce RTX 3070');
});

test('pickGpu treats an APU Vega as integrated but not a dedicated RX Vega', () => {
  const apu = d.pickGpu([
    { vendor: 'AMD', model: 'Radeon Vega 8 Graphics', vram: 512 },
    { vendor: 'NVIDIA', model: 'GeForce GT 1030', vram: 2048 },
  ]);
  assert.equal(apu.model, 'GeForce GT 1030');

  const dedicated = d.pickGpu([{ vendor: 'AMD', model: 'Radeon RX Vega 56', vram: 8192 }]);
  assert.equal(dedicated.model, 'Radeon RX Vega 56');
});

test('pickGpu handles an empty controller list', () => {
  assert.deepEqual(d.pickGpu([]), { model: null, vendor: null, vramMB: null });
  assert.deepEqual(d.pickGpu(null), { model: null, vendor: null, vramMB: null });
});

test('windowsVersionFrom reads the distro string', () => {
  assert.equal(d.windowsVersionFrom('Microsoft Windows 11 Home', '10.0.26200'), 11);
  assert.equal(d.windowsVersionFrom('Microsoft Windows 10 Pro', '10.0.19045'), 10);
  assert.equal(d.windowsVersionFrom('Microsoft Windows 8.1', '6.3.9600'), 8.1);
});

test('windowsVersionFrom falls back to the build number for 11-as-10.0', () => {
  assert.equal(d.windowsVersionFrom('', '10.0.22631'), 11);
  assert.equal(d.windowsVersionFrom('', '10.0.19045'), 10);
  assert.equal(d.windowsVersionFrom('', ''), null);
});

test('directXForWindows maps OS to the level it can expose', () => {
  assert.equal(d.directXForWindows(11), 12);
  assert.equal(d.directXForWindows(10), 12);
  assert.equal(d.directXForWindows(8.1), 11.2);
  assert.equal(d.directXForWindows(7), 11);
  assert.equal(d.directXForWindows(null), null);
});

test('pickSystemDisk picks the volume Windows lives on', () => {
  const list = [
    { mount: 'D:', available: 900 * 1024 ** 3 },
    { mount: 'C:', available: 120 * 1024 ** 3 },
  ];
  const gb = d.pickSystemDisk(list);
  assert.ok(Math.abs(gb - 120) < 1, `expected ~120 GB, got ${gb}`);
});

test('pickSystemDisk derives free space when only size/used are given', () => {
  const gb = d.pickSystemDisk([{ mount: 'C:', size: 100 * 1024 ** 3, used: 40 * 1024 ** 3 }]);
  assert.ok(Math.abs(gb - 60) < 1, `expected ~60 GB, got ${gb}`);
});

test('pickSystemDisk tolerates an empty list', () => {
  assert.equal(d.pickSystemDisk([]), null);
  assert.equal(d.pickSystemDisk(null), null);
});

test('cleanDeviceName strips the vendor boilerplate WMI adds', () => {
  assert.equal(
    d.cleanDeviceName('Advanced Micro Devices, Inc. AMD Radeon RX 580'),
    'AMD Radeon RX 580'
  );
  assert.equal(d.cleanDeviceName('Intel(R) Core(TM) i7-6700'), 'Intel Core i7-6700');
  assert.equal(d.cleanDeviceName(null), null);
});
