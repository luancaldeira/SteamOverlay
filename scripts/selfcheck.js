'use strict';
// End-to-end smoke check with no network and no Electron: every module loads,
// the packaged file list exists on disk, and a real Steam requirement fragment
// makes it all the way through parse -> compare -> extras.
//
// This is the gate that catches "it passes unit tests but the app is broken",
// e.g. a renamed export or a missing asset that only shows up after packaging.

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const problems = [];

function check(label, fn) {
  try {
    const detail = fn();
    process.stdout.write(`  ok   ${label}${detail ? ` — ${detail}` : ''}\n`);
  } catch (e) {
    problems.push(`${label}: ${e.message}`);
    process.stdout.write(`  FAIL ${label} — ${e.message}\n`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Isolate anything that writes to userData so a self-check never touches the
// real settings/cache of an installed copy.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sso-selfcheck-'));
require('../lib/appPaths')._setUserDataDir(tmpDir);

process.stdout.write('selfcheck\n');

check('every lib module loads', () => {
  const files = fs.readdirSync(path.join(ROOT, 'lib')).filter((f) => f.endsWith('.js'));
  for (const f of files) require(path.join(ROOT, 'lib', f));
  return `${files.length} modules`;
});

check('packaged files all exist', () => {
  const pkg = require(path.join(ROOT, 'package.json'));
  const entries = pkg.build.files.filter((f) => !f.includes('*'));
  for (const f of entries) assert(fs.existsSync(path.join(ROOT, f)), `missing ${f}`);
  for (const dir of ['lib', 'data', 'assets']) {
    const full = path.join(ROOT, dir);
    assert(fs.existsSync(full), `missing directory ${dir}`);
    assert(fs.readdirSync(full).length > 0, `${dir} is empty`);
  }
  return `${entries.length} files + 3 dirs`;
});

check('icons are present and non-trivial', () => {
  for (const [rel, min] of [
    ['build/icon.ico', 5000],
    ['assets/icon.png', 500],
    ['assets/tray.png', 200],
  ]) {
    const full = path.join(ROOT, rel);
    assert(fs.existsSync(full), `missing ${rel} (run: npm run icons)`);
    assert(fs.statSync(full).size >= min, `${rel} looks truncated`);
  }
  const ico = fs.readFileSync(path.join(ROOT, 'build/icon.ico'));
  assert(ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1, 'icon.ico header is not an ICO');
  return `${ico.readUInt16LE(4)} sizes in icon.ico`;
});

check('preload surface matches renderer usage', () => {
  const preload = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(ROOT, 'renderer.js'), 'utf8');
  const used = new Set([...renderer.matchAll(/window\.api\.(\w+)/g)].map((m) => m[1]));
  for (const name of used) {
    assert(new RegExp(`\\b${name}\\s*:`).test(preload), `renderer calls api.${name}, preload does not expose it`);
  }
  return `${used.size} bridged calls`;
});

check('main.js ipc handlers cover the preload bridge', () => {
  const preload = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const channels = new Set(
    [...preload.matchAll(/ipcRenderer\.(?:invoke|send)\('([^']+)'/g)].map((m) => m[1])
  );
  for (const ch of channels) {
    assert(
      new RegExp(`ipcMain\\.(handle|on)\\('${ch}'`).test(main),
      `channel "${ch}" has no handler in main.js`
    );
  }
  return `${channels.size} channels`;
});

check('requirement fragment -> comparison pipeline', () => {
  const scraper = require('../lib/steamScraper');
  const compare = require('../lib/compare');
  const extras = require('../lib/extras');

  // Verbatim shape of Steam's appdetails pc_requirements.minimum payload.
  const fragment =
    '<strong>Minimum:</strong><br><ul class="bb_ul">' +
    '<li>Requires a 64-bit processor and operating system<br></li>' +
    '<li><strong>OS:</strong> 64-bit Windows 10<br></li>' +
    '<li><strong>Processor:</strong> Core i7-6700 or Ryzen 5 1600<br></li>' +
    '<li><strong>Memory:</strong> 12 GB RAM<br></li>' +
    '<li><strong>Graphics:</strong> GeForce GTX 1060 6GB or Radeon RX 580 8GB or Arc A380<br></li>' +
    '<li><strong>DirectX:</strong> Version 12<br></li>' +
    '<li><strong>Storage:</strong> 70 GB available space</li></ul>';

  const block = scraper.parseRequirementsFragment(fragment);
  assert(block, 'fragment did not parse');
  assert(block.cpu && block.gpu && block.ram, 'cpu/gpu/ram missing from parsed block');
  assert(block.requires64 === true, '64-bit note was not detected');

  const specs = {
    cpu: 'AMD Ryzen 5 5600X 6-Core Processor',
    gpu: 'NVIDIA GeForce RTX 3070',
    gpuVramMB: 8192,
    ramGB: 16,
    cpuCores: 6,
    cpuThreads: 12,
    cpuGHz: 4.6,
    windowsVersion: 11,
    directX: 12,
    arch: 'x64',
    freeDiskGB: 200,
  };
  const tables = compare.loadTables();
  const result = compare.compareBlock(block, specs, tables);
  assert(result.overall != null, 'overall score is null on a fully specified block');
  assert(result.components.gpu.identified, 'gpu not identified');
  assert(result.components.cpu.identified, 'cpu not identified');
  assert(result.components.ram.identified, 'ram not identified');
  assert(result.overall >= 70, `expected a comfortable score, got ${result.overall}`);

  const chips = extras.buildExtras(block, specs);
  assert(chips.length === 4, `expected 4 extra chips, got ${chips.length}`);
  assert(
    chips.every((c) => c.ok === true),
    'every extra should pass for this machine'
  );
  return `overall ${result.overall}%, ${chips.length} extras`;
});

check('settings survive a round-trip and reject junk', () => {
  const settings = require('../lib/settings');
  settings._reset();
  settings.patch({ opacity: 0.7, compact: true, reqType: 'minimum' });
  settings.flush();
  settings._reset();
  const back = settings.all();
  assert(back.opacity === 0.7, `opacity did not persist (${back.opacity})`);
  assert(back.compact === true, 'compact did not persist');
  assert(back.reqType === 'minimum', 'reqType did not persist');
  const junk = settings.sanitize({ opacity: 0, reqType: 'nope', alwaysOnTop: 'yes' });
  assert(junk.opacity >= settings.MIN_OPACITY, 'opacity 0 would make the window invisible');
  assert(junk.reqType === 'recommended', 'invalid reqType not reset');
  assert(junk.alwaysOnTop === true, 'non-boolean did not fall back to the default');
  return 'ok';
});

check('disk cache round-trip', () => {
  const cache = require('../lib/cache');
  cache._reset();
  cache.set('selfcheck', 'k', { hello: 'world' });
  cache.flush();
  cache._reset();
  const v = cache.get('selfcheck', 'k', 60000);
  assert(v && v.hello === 'world', 'cache value did not survive a flush + reload');
  assert(cache.get('selfcheck', 'k', -1) === null, 'TTL is not being honoured');
  assert(cache.getStale('selfcheck', 'k') !== null, 'stale read should ignore the TTL');
  return 'ok';
});

try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {
  /* temp dir cleanup is best effort */
}

if (problems.length) {
  process.stdout.write(`\n${problems.length} problem(s)\n`);
  process.exit(1);
}
process.stdout.write('\nall checks passed\n');
