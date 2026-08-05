'use strict';
// Data gate for the benchmark tables. Run by `npm run verify`.
//
// The tables are hand-maintained estimates, so the thing that actually matters
// is internal coherence: no duplicates, every key reachable by the matcher, and
// scores that rise with tier inside a family+generation bucket. A wrong absolute
// number costs a few percent; a wrong ORDER makes the overlay lie.

const fs = require('fs');
const path = require('path');
const c = require('../lib/compare');

const ROOT = path.join(__dirname, '..');
const INVERSION_TOLERANCE = 0.2; // below this, an out-of-order pair is a warning

// Orderings that must hold no matter how the tables are edited.
const EXPECTED_GPU_ORDER = [
  ['geforce gtx 1050 ti', 'geforce gtx 1060'],
  ['geforce gtx 1060', 'geforce gtx 1070'],
  ['geforce gtx 1660', 'geforce rtx 2060'],
  ['geforce rtx 2070', 'geforce rtx 3070'],
  ['geforce rtx 3070', 'geforce rtx 4070'],
  ['radeon rx 570', 'radeon rx 580'],
  ['radeon rx 580', 'radeon rx 5700 xt'],
  ['radeon rx 6600', 'radeon rx 6700 xt'],
  ['intel uhd graphics 630', 'geforce gtx 1050 ti'],
];
const EXPECTED_CPU_ORDER = [
  ['core i5-2500k', 'core i5-9400'],
  ['core i5-9400', 'core i5-12400'],
  ['core i7-6700', 'core i7-8700'],
  ['core i7-8700k', 'core i7-12700k'],
  ['ryzen 5 1600', 'ryzen 5 3600'],
  ['ryzen 5 3600', 'ryzen 5 5600x'],
  ['ryzen 7 2700x', 'ryzen 7 5800x'],
  ['core 2 quad q6600', 'core i5-2500k'],
];

const errors = [];
const warnings = [];

function err(msg) {
  errors.push(msg);
}
function warn(msg) {
  warnings.push(msg);
}

function checkRawDuplicates(file, raw) {
  const keys = [...raw.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1]).filter((k) => k !== 'scores' && k !== '_note');
  const seen = new Set();
  for (const k of keys) {
    if (seen.has(k)) err(`${file}: duplicate key "${k}"`);
    seen.add(k);
  }
  return keys.length;
}

function checkKeys(file, scores) {
  for (const [k, v] of Object.entries(scores)) {
    if (k !== k.toLowerCase()) err(`${file}: key not lowercase: "${k}"`);
    if (k !== k.trim() || /\s{2,}/.test(k)) err(`${file}: key has stray whitespace: "${k}"`);
    if (/[®™©()]/.test(k)) err(`${file}: key has trademark/paren chars: "${k}"`);
    if (!Number.isInteger(v) || v <= 0) err(`${file}: "${k}" score is not a positive integer (${v})`);
    // Every key must be findable by the matcher against its own name, otherwise
    // it is dead weight that can never be selected.
    const m = c.matchScore(k, scores);
    if (!m) err(`${file}: "${k}" is unreachable by matchScore`);
  }
}

function checkMonotonic(file, scores, families) {
  const buckets = new Map();
  for (const [key, score] of Object.entries(scores)) {
    const sig = c.parseModel(key, families);
    if (!sig) continue;
    const id = `${sig.fam}|${sig.gen}`;
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id).push({ key, score, effRank: sig.effRank });
  }
  let bucketed = 0;
  for (const [id, arr] of buckets) {
    bucketed += arr.length;
    arr.sort((a, b) => a.effRank - b.effRank || a.score - b.score);
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i];
      const b = arr[i + 1];
      if (b.effRank === a.effRank) continue; // same tier, ties are fine
      if (b.score >= a.score) continue;
      const drop = (a.score - b.score) / a.score;
      const msg = `${file}: ${id} out of order — "${a.key}"=${a.score} then "${b.key}"=${b.score} (-${(drop * 100).toFixed(0)}%)`;
      if (drop > INVERSION_TOLERANCE) err(msg);
      else warn(msg);
    }
  }
  return { buckets: buckets.size, bucketed };
}

function checkExpected(file, scores, pairs) {
  for (const [lo, hi] of pairs) {
    if (!(lo in scores)) {
      err(`${file}: expected anchor "${lo}" is missing`);
      continue;
    }
    if (!(hi in scores)) {
      err(`${file}: expected anchor "${hi}" is missing`);
      continue;
    }
    if (!(scores[hi] > scores[lo])) {
      err(`${file}: "${hi}"(${scores[hi]}) must outscore "${lo}"(${scores[lo]})`);
    }
  }
}

function run() {
  const targets = [
    { file: 'data/gpu-benchmarks.json', families: c.GPU_FAMILIES, expected: EXPECTED_GPU_ORDER },
    { file: 'data/cpu-benchmarks.json', families: c.CPU_FAMILIES, expected: EXPECTED_CPU_ORDER },
  ];
  for (const t of targets) {
    const full = path.join(ROOT, t.file);
    const raw = fs.readFileSync(full, 'utf8');
    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      err(`${t.file}: invalid JSON — ${e.message}`);
      continue;
    }
    if (!json.scores || typeof json.scores !== 'object') {
      err(`${t.file}: missing "scores" object`);
      continue;
    }
    const rawCount = checkRawDuplicates(t.file, raw);
    checkKeys(t.file, json.scores);
    const { buckets, bucketed } = checkMonotonic(t.file, json.scores, t.families);
    checkExpected(t.file, json.scores, t.expected);
    const n = Object.keys(json.scores).length;
    process.stdout.write(
      `${t.file}: ${n} entries (${rawCount} raw), ${buckets} family buckets, ${bucketed} interpolatable\n`
    );
  }

  for (const w of warnings) process.stdout.write(`  warn: ${w}\n`);
  for (const e of errors) process.stdout.write(`  ERROR: ${e}\n`);
  process.stdout.write(`\n${errors.length} error(s), ${warnings.length} warning(s)\n`);
  if (errors.length) process.exit(1);
}

run();
