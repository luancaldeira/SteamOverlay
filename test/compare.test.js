'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const c = require('../lib/compare');

const cpuScores = {
  'core i5': 6000,
  'core i5-9400': 11500,
  'core i7-6700': 8800,
  'ryzen 5 1600': 10500,
};
const gpuScores = {
  'geforce gtx 1060': 9300,
  'geforce gtx 1060 3gb': 8700,
  'radeon rx 580': 8900,
  'geforce rtx 3070': 22500,
};

test('normalize strips trademark/parens/hyphens and collapses space', () => {
  assert.equal(c.normalize('Intel®  Core™ i7-6700 (Skylake)'), 'intel core i7 6700 skylake');
});

test('matchScore prefers longest match, not a bare prefix', () => {
  const m = c.matchScore('Intel Core i5-9400 or better', cpuScores);
  assert.equal(m.key, 'core i5-9400');
});

test('matchScore tolerates missing manufacturer prefix in requirement text', () => {
  // table key has "geforce" prefix; requirement text omits it
  const m = c.matchScore('GTX 1060', gpuScores);
  assert.equal(m.key, 'geforce gtx 1060');
});

test('matchScore distinguishes 1060 vs 1060 3gb by longest form', () => {
  assert.equal(c.matchScore('NVIDIA GeForce GTX 1060 3GB', gpuScores).key, 'geforce gtx 1060 3gb');
  assert.equal(c.matchScore('NVIDIA GeForce GTX 1060 6GB', gpuScores).key, 'geforce gtx 1060');
});

test('matchScore matches AMD alternative in a combined string', () => {
  const m = c.matchScore('Core i7-6700 or AMD Ryzen 5 1600', cpuScores);
  // longest key present is "core i7-6700" (12) vs "ryzen 5 1600" (12) — first-longest wins deterministically
  assert.ok(['core i7-6700', 'ryzen 5 1600'].includes(m.key));
});

test('matchScore returns null when nothing matches', () => {
  assert.equal(c.matchScore('Some Potato CPU 9000', cpuScores), null);
});

test('matchScore does not match a model number inside a longer number', () => {
  const s = { 'radeon rx 580': 8900 };
  assert.equal(c.matchScore('Radeon RX 5800 XT', s), null); // must NOT match rx 580
  assert.equal(c.matchScore('Radeon RX 580', s).key, 'radeon rx 580');
  assert.equal(c.matchScore('Radeon RX 580 8GB', s).key, 'radeon rx 580');
});

test('matchScore still allows a letter suffix variant to match its base', () => {
  const s = { 'core i7-6700': 8800 };
  assert.equal(c.matchScore('Intel Core i7-6700K', s).key, 'core i7-6700');
});

test('scoreFromRatio curve breakpoints', () => {
  assert.equal(c.scoreFromRatio(1.4), 100);
  assert.equal(c.scoreFromRatio(2.0), 100);
  assert.equal(c.scoreFromRatio(1.0), 70);
  assert.equal(c.scoreFromRatio(0.7), 40);
  assert.equal(c.scoreFromRatio(0.35), 20);
  assert.equal(c.scoreFromRatio(0), 0);
  // midpoints
  assert.equal(c.scoreFromRatio(1.2), 85); // 70 + (0.2/0.4)*30
  assert.equal(c.scoreFromRatio(0.85), 55); // 40 + (0.15/0.3)*30
});

test('parseRamGB handles GB and MB', () => {
  assert.equal(c.parseRamGB('8 GB RAM'), 8);
  assert.equal(c.parseRamGB('Memory: 16 GB'), 16);
  assert.equal(c.parseRamGB('4096 MB'), 4);
  assert.equal(c.parseRamGB('no numbers here'), null);
});

test('compareRam ratio scoring', () => {
  const r = c.compareRam(16, '8 GB RAM');
  assert.equal(r.identified, true);
  assert.equal(r.score, 100); // ratio 2.0
});

test('compareBench flags user-unmatched vs requirement-unmatched distinctly', () => {
  const reqUnmatched = c.compareBench('Core i5-9400', 'Potato 9000', cpuScores);
  assert.equal(reqUnmatched.identified, false);
  assert.equal(reqUnmatched.reason, 'requirement-unmatched');

  const userUnmatched = c.compareBench('Potato 9000', 'Core i5-9400', cpuScores);
  assert.equal(userUnmatched.identified, false);
  assert.equal(userUnmatched.reason, 'user-unmatched');
});

test('compareBlock renormalizes weights over identified components only', () => {
  const specs = { cpu: 'Core i5-9400', gpu: 'Potato GPU', ramGB: 16 };
  const req = { cpu: 'Core i7-6700', gpu: 'GeForce RTX 3070', ram: '8 GB' };
  const tables = { cpu: cpuScores, gpu: gpuScores };
  const block = c.compareBlock(req, specs, tables);
  // gpu excluded (user unmatched); overall from cpu(0.35)+ram(0.20) renormalized
  assert.equal(block.components.gpu.identified, false);
  assert.equal(block.components.cpu.identified, true);
  assert.equal(block.components.ram.identified, true);
  const cpuS = block.components.cpu.score;
  const ramS = block.components.ram.score;
  const expected = Math.round((cpuS * 0.35 + ramS * 0.20) / (0.35 + 0.20));
  assert.equal(block.overall, expected);
});

test('compareBlock overall null when nothing identified', () => {
  const specs = { cpu: 'Potato', gpu: 'Potato', ramGB: 0 };
  const req = { cpu: 'Alien', gpu: 'Alien', ram: 'lots' };
  const tables = { cpu: cpuScores, gpu: gpuScores };
  const block = c.compareBlock(req, specs, tables);
  assert.equal(block.overall, null);
  assert.equal(block.verdict, 'não foi possível estimar');
});

test('matchScore is separator-insensitive ("i5 750" matches "core i5-750")', () => {
  const s = { 'core i5-750': 2400 };
  assert.equal(c.matchScore('Intel Core i5 750 or higher', s).key, 'core i5-750');
});

test('parseGenericCpu extracts threads / cores / ghz', () => {
  assert.deepEqual(c.parseGenericCpu('4 hardware CPU threads'), { threads: 4, cores: null, ghz: null });
  assert.deepEqual(c.parseGenericCpu('Quad-core 2.5 GHz'), { threads: null, cores: 4, ghz: 2.5 });
  assert.deepEqual(c.parseGenericCpu('Dual core from Intel or AMD'), { threads: null, cores: 2, ghz: null });
  assert.equal(c.parseGenericCpu('Intel Core i7-6700'), null); // no generic signal
});

test('compareCpu falls back to generic thread/ghz comparison when no model matches', () => {
  const specs = { cpu: 'AMD Ryzen 5 5600GT', cpuThreads: 12, cpuCores: 6, cpuGHz: 4.6 };
  const r = c.compareCpu(specs, '4 hardware CPU threads - some unknown chip', {});
  assert.equal(r.identified, true);
  assert.equal(r.method, 'generic');
  assert.ok(r.score >= 85); // 12 threads vs 4 required -> easily passes
});

test('compareCpu prefers an exact model match over generic', () => {
  const scores = { 'core i7-6700': 8800 };
  const specs = { cpu: 'Intel Core i7-6700', cpuThreads: 8, cpuCores: 4, cpuGHz: 3.4 };
  const r = c.compareCpu(specs, 'Core i7-6700 (4 threads)', scores);
  assert.equal(r.method, 'model');
});

test('verdictFor bands', () => {
  assert.equal(c.verdictFor(90), 'roda tranquilo');
  assert.equal(c.verdictFor(70), 'deve rodar bem');
  assert.equal(c.verdictFor(50), 'no limite, espere quedas / baixar gráficos');
  assert.equal(c.verdictFor(30), 'abaixo do requisito');
  assert.equal(c.verdictFor(null), 'não foi possível estimar');
});
