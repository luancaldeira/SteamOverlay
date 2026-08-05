'use strict';
// Tests for the matching rules added in 1.0: alternative ("or") semantics,
// negation guards, device-name cleanup, family estimation and the VRAM gate.
const { test } = require('node:test');
const assert = require('node:assert');
const c = require('../lib/compare');

const gpuScores = {
  'geforce gtx 1060': 9300,
  'geforce gtx 1060 3gb': 8700,
  'geforce rtx 3050': 13000,
  'geforce rtx 3060': 17000,
  'geforce rtx 3070': 22500,
  'radeon rx 580': 8900,
  'radeon rx 590': 9600,
  'radeon rx 5300': 7000,
  'arc a380': 8000,
  'intel uhd graphics 630': 1000,
};
const cpuScores = {
  'core i5-9400': 11500,
  'core i7-6700': 8800,
  'core i7-6800k': 12000,
  'ryzen 5 1600': 10500,
  'ryzen 5 5600x': 22000,
  'ryzen 7 5800x': 28000,
};

// ---- alternatives --------------------------------------------------------
test('splitAlternatives breaks on or / slash / comma / pipe', () => {
  assert.deepEqual(c.splitAlternatives('GTX 1060 or RX 580'), ['gtx 1060', 'rx 580']);
  assert.deepEqual(c.splitAlternatives('GTX 1060/RX 580'), ['gtx 1060', 'rx 580']);
  assert.deepEqual(c.splitAlternatives('GTX 1060, RX 580'), ['gtx 1060', 'rx 580']);
});

test('a requirement listing alternatives takes the weakest one', () => {
  // any of the three satisfies the game, so the bar is the cheapest card
  const m = c.matchRequirement('GeForce GTX 1060 6GB or Radeon RX 580 8GB or Arc A380', gpuScores);
  assert.equal(m.key, 'arc a380');
  assert.equal(m.score, 8000);
  assert.equal(m.alternatives.length, 3);
});

test('alternatives rule applies to CPUs too', () => {
  const m = c.matchRequirement('Core i7-6700 or Ryzen 5 1600', cpuScores);
  assert.equal(m.key, 'core i7-6700'); // 8800 < 10500
});

test('a single-model requirement is unaffected', () => {
  const m = c.matchRequirement('Intel Core i5-9400', cpuScores);
  assert.equal(m.key, 'core i5-9400');
  assert.deepEqual(m.alternatives, ['core i5-9400']);
});

test('a negated alternative does not lower the bar', () => {
  const m = c.matchRequirement('Radeon RX 580 (Intel UHD Graphics 630 not supported)', gpuScores);
  assert.equal(m.key, 'radeon rx 580');
});

test('user side keeps longest-match, not weakest-match', () => {
  const m = c.matchUser('NVIDIA GeForce GTX 1060 3GB', gpuScores);
  assert.equal(m.key, 'geforce gtx 1060 3gb');
});

// ---- device name cleanup -------------------------------------------------
test('normalizeDevice strips WMI vendor boilerplate', () => {
  const n = c.normalizeDevice('Advanced Micro Devices, Inc. AMD Radeon RX 580');
  assert.ok(!n.includes('advanced micro devices'), n);
  assert.ok(!/\binc\b/.test(n), n);
  assert.ok(n.includes('radeon rx 580'), n);
});

test('matchUser survives an ASCII (R)/(TM) device name', () => {
  const m = c.matchUser('Intel(R) UHD Graphics 630', gpuScores);
  assert.equal(m.key, 'intel uhd graphics 630');
});

test('normalize splits a family or variant glued to the model number', () => {
  // old store listings write "HD2600", "GTX1060", "9600GT", "6600XT"
  assert.equal(c.normalize('GTX1060'), 'gtx 1060');
  assert.equal(c.normalize('Radeon HD2600'), 'radeon hd 2600');
  assert.equal(c.normalize('9600GT'), '9600 gt');
  assert.equal(c.normalize('RX6600XT'), 'rx 6600 xt');
});

test('a glued model name still matches its table key', () => {
  assert.equal(c.matchUser('GTX1060', gpuScores).key, 'geforce gtx 1060');
  assert.equal(c.matchRequirement('RX580 or GTX1060', gpuScores).key, 'radeon rx 580');
});

// ---- family estimation ---------------------------------------------------
test('parseModel separates reused numbers across eras', () => {
  const a = c.parseModel('radeon rx 590', c.GPU_FAMILIES);
  const b = c.parseModel('radeon rx 5300', c.GPU_FAMILIES);
  assert.notEqual(`${a.fam}|${a.gen}`, `${b.fam}|${b.gen}`);
});

test('parseModel separates laptop and APU parts from desktop', () => {
  const desktop = c.parseModel('geforce gtx 960', c.GPU_FAMILIES);
  const mobile = c.parseModel('geforce gtx 960m', c.GPU_FAMILIES);
  assert.notEqual(desktop.fam, mobile.fam);

  const cpu = c.parseModel('ryzen 3 3100', c.CPU_FAMILIES);
  const apu = c.parseModel('ryzen 3 3200g', c.CPU_FAMILIES);
  assert.notEqual(cpu.fam, apu.fam);
});

test('parseModel ranks suffixes without leapfrogging the next model number', () => {
  const base = c.parseModel('geforce rtx 3060', c.GPU_FAMILIES);
  const ti = c.parseModel('geforce rtx 3060 ti', c.GPU_FAMILIES);
  const next = c.parseModel('geforce rtx 3070', c.GPU_FAMILIES);
  assert.ok(base.effRank < ti.effRank, 'ti must rank above its base');
  assert.ok(ti.effRank < next.effRank, 'ti must stay below the next model up');
});

test('parseModel reads SKUs whose suffix is glued to the digits', () => {
  assert.ok(c.parseModel('core i5-9400f', c.CPU_FAMILIES), 'i5-9400f');
  assert.ok(c.parseModel('ryzen 7 5800x3d', c.CPU_FAMILIES), 'ryzen 7 5800x3d');
  assert.ok(c.parseModel('core i9-13900ks', c.CPU_FAMILIES), 'i9-13900ks');
});

test('estimate interpolates an unknown model between its neighbours', () => {
  const e = c.estimate('GeForce RTX 3055', gpuScores, c.GPU_FAMILIES);
  assert.ok(e, 'expected an estimate');
  assert.equal(e.approx, true);
  assert.ok(e.score > gpuScores['geforce rtx 3050'], 'above the 3050');
  assert.ok(e.score < gpuScores['geforce rtx 3060'], 'below the 3060');
});

test('estimate clamps instead of extrapolating past the ends', () => {
  const high = c.estimate('GeForce RTX 3099', gpuScores, c.GPU_FAMILIES);
  assert.equal(high.score, gpuScores['geforce rtx 3070']);
});

test('estimate refuses unrelated text', () => {
  assert.equal(c.estimate('Potato Graphics 9000', gpuScores, c.GPU_FAMILIES), null);
  assert.equal(c.estimate('', gpuScores, c.GPU_FAMILIES), null);
});

test('compareBench marks a result as approximate when it had to estimate', () => {
  const r = c.compareBench('GeForce RTX 3055', 'GeForce GTX 1060', gpuScores, c.GPU_FAMILIES);
  assert.equal(r.identified, true);
  assert.equal(r.approx, true);
});

// ---- VRAM ----------------------------------------------------------------
test('parseVramGB takes the smallest figure across alternatives', () => {
  assert.equal(c.parseVramGB('GeForce GTX 1060 6GB or Radeon RX 580 8GB'), 6);
  assert.equal(c.parseVramGB('GeForce GTX 1060'), null);
  assert.equal(c.parseVramGB('Radeon RX 580 4096 MB'), 4);
});

test('compareGpu caps the score when the card lacks the required VRAM', () => {
  const specs = { gpu: 'GeForce RTX 3070', gpuVramMB: 2048 };
  const r = c.compareGpu(specs, 'GeForce GTX 1060 6GB', gpuScores);
  assert.equal(r.identified, true);
  assert.equal(r.vram.ok, false);
  assert.equal(r.vramCapped, true);
  assert.ok(r.score < 100, `expected the 2 GB card to be penalised, got ${r.score}`);
});

test('compareGpu leaves the score alone when VRAM is sufficient', () => {
  const specs = { gpu: 'GeForce RTX 3070', gpuVramMB: 8192 };
  const r = c.compareGpu(specs, 'GeForce GTX 1060 6GB', gpuScores);
  assert.equal(r.vram.ok, true);
  assert.ok(!r.vramCapped);
  assert.equal(r.score, 100);
});

test('compareGpu is unaffected when the requirement mentions no VRAM', () => {
  const specs = { gpu: 'GeForce GTX 1060', gpuVramMB: 3072 };
  const r = c.compareGpu(specs, 'GeForce GTX 1060', gpuScores);
  assert.equal(r.vram, undefined, 'no VRAM figure in the requirement -> no VRAM verdict');
  assert.equal(r.score, 70, 'exactly meeting the requirement scores 70 on the curve');
});

test('a negated clause outside parentheses is dropped too', () => {
  const m = c.matchRequirement('Radeon RX 580; Intel UHD Graphics 630 not supported', gpuScores);
  assert.equal(m.key, 'radeon rx 580');
});
