# Suporte universal a Linux — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Steam Spec Overlay on Linux — detecting Steam, the open/running game, and the machine's real hardware — with honest degradation wherever a compositor or a sandbox refuses something Windows allows, and with AppImage + deb artifacts built in CI.

**Architecture:** All OS-specific Steam detection moves behind one seam, `lib/platform/`, which reads `process.platform` exactly once; `lib/steamSetup.js` and `lib/windowFallback.js` stay as facades so `main.js` never learns there is more than one OS. Linux detection is built entirely on `fs` reads — Steam's own `.vdf`/`.acf` files for install layout, `/proc` for process state — so the environment loop keeps spawning nothing, matching the constraint the Windows implementation already pays for. Everything the Linux port cannot know honestly (Proton compatibility, VRAM behind a small PCI BAR, a Wayland compositor's refusal to honour always-on-top) is surfaced as an explicit unknown rather than as a confident wrong answer.

**Tech Stack:** Electron 32 (CommonJS, no build step), `node --test`, `systeminformation` v5, `cheerio`, electron-builder 25.1.8, GitHub Actions. No new runtime dependencies are added anywhere in this plan.

---

## What actually breaks today

The detection core is already portable and must not be "ported": `lib/steamDebug.js` (CDP over `127.0.0.1:8080`), `lib/steamApi.js` and `lib/steamScraper.js` (HTTP to Steam) contain zero OS-specific code, and Linux Steam is the same CEF build honouring the same `.cef-enable-remote-debugging` flag file. `lib/appPaths.js`, `lib/cache.js`, `lib/settings.js`, `lib/logger.js`, `lib/jsonFile.js`, `lib/compare.js` and both `scripts/*.js` quality gates are already cross-platform.

What breaks, ranked:

| # | Problem | Where | On Linux today | Phase |
|---|---|---|---|---|
| 1 | Steam install found via `reg query`; running-check via `tasklist` | `lib/steamSetup.js:27,38-46,75-84` | Silently no-ops → permanently "Steam não está aberta" | 0–1 |
| 2 | No-CDP fallback reads `tasklist /V` window titles | `lib/windowFallback.js:14,44-47` | Silently no-ops → safety net dead | 0, 2 |
| 3 | `pickGpu()` misclassifies AMD APUs as dedicated cards | `lib/detectSpecs.js:17-38` | **Wrong comparison**, not just a missing one | 3 |
| 4 | VRAM read from a PCI BAR window under-reports 8 GB as 256 MB | `lib/detectSpecs.js` via `systeminformation` | Caps a capable card in `compare.js`'s VRAM gate | 3 |
| 5 | Free space picked by `%SystemDrive%` | `lib/detectSpecs.js:69-77` | Falls through to `fsList[0]` — usually the wrong partition | 3 |
| 6 | Only the `data-os="win"` requirements block is ever read | `lib/steamScraper.js:90-99`, `lib/steamApi.js:67` | A Windows panel shown on Linux with no explanation | 4 |
| 7 | `windowsVersion` / `directX` are the only OS chips | `lib/extras.js:61-84`, `lib/detectSpecs.js:40-65` | Two chips stuck at "unknown" forever | 3 |
| 8 | `transparent:true` needs a compositor; always-on-top, click-through, `globalShortcut` and positioning vary or fail per compositor | `main.js:263-264,304-305,506-516` | Degrades silently, worst on GNOME Wayland | 5 |
| 9 | Tray is the documented sole recovery path from click-through | `main.js:333-334,374-384` | Invisible on stock GNOME → user can get stuck | 5 |
| 10 | `app.setLoginItemSettings` is Windows/macOS-only | `main.js:389` | Checkbox flips, persists, does nothing | 5 |
| 11 | No `linux` build target; `author` is empty; description ends in "(Windows)" | `package.json:4,6,15,39-45` | Nothing to ship | 6 |

## File structure

**New modules**

| File | Responsibility |
|---|---|
| `lib/platform/index.js` | The only place in the app that reads `process.platform`; dispatches to one impl |
| `lib/platform/win32.js` | Today's Windows guts, moved unchanged |
| `lib/platform/linux.js` | Steam root + flavor, `/proc` process state, flag file, running-game fallback |
| `lib/vdf.js` | Pure Valve KeyValues text parser (no I/O) |
| `lib/steamLibrary.js` | `libraryfolders.vdf` / `appmanifest_*.acf` reader — cross-platform |
| `lib/vulkan.js` | Vulkan API version from driver ICD manifests |
| `lib/protondb.js` | ProtonDB tier, main-process only, week-long cache |
| `lib/proton.js` | Installed Proton builds + `CompatToolMapping` |
| `lib/session.js` | Session type, desktop, and a per-capability support matrix |
| `lib/autostart.js` | XDG `~/.config/autostart` entry, AppImage-aware |
| `.github/workflows/release.yml` | Windows + Linux matrix build on tag push |

**Modified**

`lib/steamSetup.js` and `lib/windowFallback.js` (become delegators) · `lib/detectSpecs.js` (platform/kernel/distro/Vulkan, GPU and VRAM fixes, disk targeting) · `lib/extras.js` (Proton and Vulkan chips) · `lib/steamApi.js` (`linux_requirements`, `pickRequirements`) · `lib/steamScraper.js` (`data-os="linux"` sibling extractor) · `main.js` (Ozone switch, session state, Proton state, requirement selection, autostart) · `renderer.js`, `index.html`, `styles.css` (Linux rig sheet, Proton chips, capability warnings, OS-neutral copy) · `scripts/make-icon.js` (Linux PNG set) · `package.json` (description, author, `linux`/`deb` blocks, dist scripts) · `README.md`.

## Phase map

| Phase | Tasks | Ships |
|---|---|---|
| 0 — Platform seam | 1–4 | Nothing user-visible; `npm test` green with no test file rewritten |
| 1 — Linux Steam discovery | 5–9 | Steam found and flagged on native / Flatpak / Snap |
| 2 — Linux game detection | 10–11 | Running game detected exactly, via `reaper` |
| 3 — Hardware detection | 12–20 | Correct GPU, honest VRAM, right disk, distro + Vulkan |
| 4 — Requirements & Proton | 21–29 | Native Linux requirements, Proton framing, ProtonDB tier |
| 5 — Window behavior & UX | 30–39 | Honest degradation per compositor, working autostart |
| 6 — Packaging & release | 40–43 | AppImage + deb, CI, README |

Phases 0–4 are testable on the maintainer's Windows box. Phases 5–6 need real Linux hardware or CI; each ends with an explicit hand-check list.

## Non-goals

- **Steam Deck Game Mode.** gamescope exposes exactly one `GAMESCOPE_EXTERNAL_OVERLAY` slot and `mangoapp` holds it permanently. Desktop Mode is supported; Game Mode is not, and cannot be without upstream work.
- **macOS.** The seam makes it possible later; nothing here targets it.
- **Flatpak/Snap packaging of this app.** Both sandboxes block writing the flag file into the user's Steam directory without privileged permissions. AppImage and deb ship instead — see Phase 6.
- **A "currently viewing" signal without CDP on Linux.** Nothing persists Steam's store-tab state, and `registry.vdf`'s `RunningAppID` has been stuck at 0 since 2023 (ValveSoftware/steam-for-linux#9672).

---


## Phase 0: Platform seam, zero behavior change on Windows

**Goal:** Extract the existing Windows-only Steam-detection code out of `lib/steamSetup.js` and `lib/windowFallback.js` into `lib/platform/win32.js`, unchanged in behavior, put a dispatcher (`lib/platform/index.js`) in front of it that reads `process.platform` exactly once, and turn the two original files into thin delegators so `main.js` and every existing test keep working without edits. No new capability ships in this phase — it is pure plumbing so Phases 1+ have one seam to plug Linux into instead of a scatter of `process.platform` checks.

**Exit criteria:**
- [ ] `lib/platform/index.js`, `lib/platform/win32.js` exist; `lib/steamSetup.js` and `lib/windowFallback.js` contain no OS-specific logic of their own anymore.
- [ ] `process.platform` appears exactly once in the whole repo (inside `lib/platform/index.js`).
- [ ] `npm test` is green with the full original suite intact — no existing test file was rewritten, only extended.
- [ ] `require('../lib/platform')` exposes exactly the locked contract: `id, findSteamPath, isSteamRunning, ensureDebugFlag, debugFlagStatus, getFallbackGame, FLAG_NAME, _reset, _pick`.

---

### Task 1: Extract the Windows implementation into `lib/platform/win32.js`

**Files:**
- Create: `lib/platform/win32.js`
- Test: `test/platform.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

test('lib/platform/win32 exists and exposes the Windows implementation', () => {
  const win32 = require('../lib/platform/win32');
  assert.equal(win32.id, 'win32');
  assert.equal(typeof win32.findSteamPath, 'function');
  assert.equal(typeof win32.isSteamRunning, 'function');
  assert.equal(typeof win32.ensureDebugFlag, 'function');
  assert.equal(typeof win32.debugFlagStatus, 'function');
  assert.equal(typeof win32.getFallbackGame, 'function');
  assert.equal(typeof win32._reset, 'function');
  assert.equal(win32.FLAG_NAME, '.cef-enable-remote-debugging');
});

test('win32.parseCsvLine reads quoted tasklist columns', () => {
  const win32 = require('../lib/platform/win32');
  const cols = win32.parseCsvLine('"steam.exe","12188","Console","1","99.284 K","Running","PC\\user","0:00:30","Dota 2"');
  assert.equal(cols.length, 9);
  assert.equal(cols[0], 'steam.exe');
  assert.equal(cols[8], 'Dota 2');
});

test('win32.titlesFromTasklist reads the last column regardless of locale', () => {
  const win32 = require('../lib/platform/win32');
  const out = win32.titlesFromTasklist(
    '"steamwebhelper.exe","1548","Console","1","273.900 K","Running","Lu\\lu","0:00:22","Half-Life 2"\r\n'
  );
  assert.deepEqual(out, ['Half-Life 2']);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/platform.test.js`
Expected: FAIL — `Cannot find module '../lib/platform/win32'`

- [ ] **Step 3: Implement**

Consolidate the Windows-only guts of today's `lib/steamSetup.js` (registry lookup, running check, debug flag) and today's `lib/windowFallback.js` (the `tasklist`-based window-title probe: `IMAGES`, `parseCsvLine`, `titlesFromTasklist`, `listTitles`, `getSteamWindowTitles`) into one file. The two `debugFlagStatus`/`ensureDebugFlag` return shapes each gain a `flavor: 'windows'` field so every platform impl returns the same shape. `getFallbackGame` requires `../windowFallback` *inside the function body*, not at the top of the file — see the comment in the code below for why.

```js
'use strict';
// Windows Steam detection: locate the install via the registry, manage the
// CEF remote-debugging flag file, check whether Steam is running, and — when
// CDP is unavailable — read Steam's window title through `tasklist` as a
// fallback signal. Moved here unchanged from steamSetup.js/windowFallback.js
// so every OS's implementation lives beside the others instead of behind
// scattered `process.platform` checks; see lib/platform/index.js.
//
// The environment loop runs every few seconds for the life of the app, so
// both the path and the running-check are memoized: the install path
// effectively never moves, and the process check is throttled. Before this,
// the overlay spawned two child processes every 3 s forever.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const log = require('../logger').scoped('setup');

const FLAG_NAME = '.cef-enable-remote-debugging';
const RUNNING_TTL_MS = 4000;

let steamPathCache = null;
let steamPathAt = 0;
const STEAM_PATH_TTL_MS = 5 * 60 * 1000; // re-check occasionally in case Steam is reinstalled

let runningCache = { value: false, at: 0 };
let runningInFlight = null;

function regQuery(root, key, value) {
  return new Promise((resolve) => {
    execFile('reg', ['query', `${root}\\${key}`, '/v', value], { windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      // line like: "    SteamPath    REG_SZ    c:/program files (x86)/steam"
      const re = new RegExp(`${value}\\s+REG_[A-Z_]+\\s+(.+)`, 'i');
      const m = stdout.match(re);
      resolve(m ? m[1].trim() : null);
    });
  });
}

async function locateSteam() {
  let p = await regQuery('HKCU', 'Software\\Valve\\Steam', 'SteamPath');
  if (!p) p = await regQuery('HKLM', 'SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath');
  if (!p) p = await regQuery('HKLM', 'SOFTWARE\\Valve\\Steam', 'InstallPath');
  if (!p) {
    // last-resort common defaults
    for (const guess of [
      'C:\\Program Files (x86)\\Steam',
      'C:\\Program Files\\Steam',
      path.join(process.env.LOCALAPPDATA || '', 'Steam'),
    ]) {
      if (guess && fs.existsSync(guess)) {
        p = guess;
        break;
      }
    }
  }
  if (!p) return null;
  return path.normalize(p.replace(/\//g, path.sep));
}

async function findSteamPath({ force = false } = {}) {
  const now = Date.now();
  if (!force && steamPathCache && now - steamPathAt < STEAM_PATH_TTL_MS) return steamPathCache;
  // A cached path that vanished (uninstall/move) must not be trusted.
  if (!force && steamPathCache && fs.existsSync(steamPathCache)) {
    steamPathAt = now;
    return steamPathCache;
  }
  const found = await locateSteam();
  steamPathCache = found;
  steamPathAt = now;
  if (found) log.debug('steam path', found);
  return found;
}

function queryRunning() {
  return new Promise((resolve) => {
    execFile(
      'tasklist',
      ['/FI', 'IMAGENAME eq steam.exe', '/NH', '/FO', 'CSV'],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        if (err || !stdout) return resolve(false);
        resolve(/steam\.exe/i.test(stdout));
      }
    );
  });
}

// Throttled + de-duplicated: concurrent callers share one child process.
function isSteamRunning({ maxAgeMs = RUNNING_TTL_MS } = {}) {
  const now = Date.now();
  if (now - runningCache.at < maxAgeMs) return Promise.resolve(runningCache.value);
  if (runningInFlight) return runningInFlight;
  runningInFlight = queryRunning().then((value) => {
    runningCache = { value, at: Date.now() };
    runningInFlight = null;
    return value;
  });
  return runningInFlight;
}

// Returns { steamPath, flagPath, flagExists, created, error, flavor }
async function ensureDebugFlag({ create = true } = {}) {
  const steamPath = await findSteamPath({ force: true });
  if (!steamPath) {
    return {
      steamPath: null,
      flagPath: null,
      flagExists: false,
      created: false,
      error: 'steam-not-found',
      flavor: 'windows',
    };
  }
  const flagPath = path.join(steamPath, FLAG_NAME);
  let flagExists = fs.existsSync(flagPath);
  let created = false;
  if (!flagExists && create) {
    try {
      fs.writeFileSync(flagPath, '');
      flagExists = true;
      created = true;
      log.info('created cef debug flag at', flagPath);
    } catch (e) {
      log.error('could not create debug flag', e);
      return { steamPath, flagPath, flagExists: false, created: false, error: e.message, flavor: 'windows' };
    }
  }
  return { steamPath, flagPath, flagExists, created, error: null, flavor: 'windows' };
}

// Check-only: does the flag exist right now (without creating it)?
async function debugFlagStatus() {
  const steamPath = await findSteamPath();
  if (!steamPath) return { steamPath: null, flagPath: null, flagExists: false, flavor: 'windows' };
  const flagPath = path.join(steamPath, FLAG_NAME);
  return { steamPath, flagPath, flagExists: fs.existsSync(flagPath), flavor: 'windows' };
}

// ---- window-title fallback ------------------------------------------------
// Modern Steam clients keep the window title at a plain "Steam", so this
// rarely fires — which is exactly why it must be cheap. The previous
// implementation compiled a C# P/Invoke shim through PowerShell on every
// tick; this one reads the title column `tasklist` already prints, parsed
// positionally so it works on a localized Windows where the column headers
// are translated.

const IMAGES = ['steamwebhelper.exe', 'steam.exe'];
const EXEC_TIMEOUT_MS = 5000;

// Placeholder titles every locale uses for "this process has no window".
const EMPTY_TITLE_RE = /^(n\/a|sem t[ií]tulo|untitled|sin t[ií]tulo|ohne titel|sans titre|senza titolo|无标题|steam)$/i;

function parseCsvLine(line) {
  const out = [];
  const re = /"((?:[^"]|"")*)"/g;
  let m;
  while ((m = re.exec(line)) !== null) out.push(m[1].replace(/""/g, '"'));
  return out;
}

function titlesFromTasklist(stdout) {
  const titles = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (cols.length < 2) continue;
    const title = (cols[cols.length - 1] || '').trim(); // last column = window title
    if (!title || EMPTY_TITLE_RE.test(title)) continue;
    titles.push(title);
  }
  return titles;
}

function listTitles(image) {
  return new Promise((resolve) => {
    execFile(
      'tasklist',
      ['/V', '/FO', 'CSV', '/NH', '/FI', `IMAGENAME eq ${image}`],
      { windowsHide: true, timeout: EXEC_TIMEOUT_MS, maxBuffer: 1024 * 512 },
      (err, stdout) => {
        if (err || !stdout) return resolve([]);
        resolve(titlesFromTasklist(stdout));
      }
    );
  });
}

async function getSteamWindowTitles() {
  for (const image of IMAGES) {
    const titles = await listTitles(image);
    if (titles.length) return titles;
  }
  return [];
}

// Best-effort guess of the game the user is viewing in Steam.
// Returns { appid, title } or null.
async function getFallbackGame() {
  // Required here, not at module load: windowFallback.js re-exports several
  // of this module's own functions below it, so a top-level require of
  // windowFallback.js here would race that load and capture an unfinished
  // module (classic CommonJS circular-require trap). By the time this
  // function actually runs — the first env tick, well after boot — the
  // module cache is fully warm regardless of load order, so a lazy require
  // is both correct and cheap (require() itself is a cache lookup).
  const { searchAppid } = require('../windowFallback');
  const titles = await getSteamWindowTitles();
  for (const title of titles) {
    const hit = await searchAppid(title);
    if (hit) return { appid: hit.appid, title: hit.name };
  }
  return null;
}

function _reset() {
  steamPathCache = null;
  steamPathAt = 0;
  runningCache = { value: false, at: 0 };
  runningInFlight = null;
}

module.exports = {
  id: 'win32',
  findSteamPath,
  isSteamRunning,
  ensureDebugFlag,
  debugFlagStatus,
  getFallbackGame,
  FLAG_NAME,
  _reset,
  // Windows-only helpers, re-exported unconditionally through
  // lib/windowFallback.js so its existing tests keep working untouched.
  getSteamWindowTitles,
  titlesFromTasklist,
  parseCsvLine,
  IMAGES,
};
```

Note: `lib/steamSetup.js` and `lib/windowFallback.js` are **not touched in this task**. They still contain their original code, so the app's actual behavior is identical to before — this task only adds a new, currently-unused-by-anything file plus its characterization test.

- [ ] **Step 4: Run the test**

Run: `node --test test/platform.test.js`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add lib/platform/win32.js test/platform.test.js && git commit -m "refactor(platform): extract Windows Steam detection into lib/platform/win32.js"
```

---

### Task 2: Add the platform dispatcher with a safe stub for unsupported OSes

**Files:**
- Create: `lib/platform/index.js`
- Test: `test/platform.test.js`

- [ ] **Step 1: Write the failing test**

Add to the bottom of `test/platform.test.js`:

```js
const CONTRACT_KEYS = [
  'id',
  'findSteamPath',
  'isSteamRunning',
  'ensureDebugFlag',
  'debugFlagStatus',
  'getFallbackGame',
  'FLAG_NAME',
  '_reset',
];

test('the live dispatcher exposes the full platform contract', () => {
  const platform = require('../lib/platform');
  for (const key of CONTRACT_KEYS) {
    assert.ok(key in platform, `missing "${key}" on the platform dispatcher`);
  }
  assert.equal(typeof platform.findSteamPath, 'function');
  assert.equal(typeof platform._pick, 'function');
  assert.equal(platform.FLAG_NAME, '.cef-enable-remote-debugging');
});

test('_pick resolves win32 to the real Windows implementation', () => {
  const platform = require('../lib/platform');
  const impl = platform._pick('win32');
  assert.equal(impl.id, 'win32');
  for (const key of CONTRACT_KEYS) assert.ok(key in impl, `win32 impl missing "${key}"`);
});

test('_pick resolves an unrecognized platform to safe no-op nulls, without faking process.platform', async () => {
  const platform = require('../lib/platform');
  const impl = platform._pick('darwin');
  assert.equal(impl.id, 'unsupported');

  assert.equal(await impl.findSteamPath({}), null);
  assert.equal(await impl.isSteamRunning({}), false);
  assert.equal(await impl.getFallbackGame(), null);

  const flag = await impl.debugFlagStatus();
  assert.equal(flag.steamPath, null);
  assert.equal(flag.flagExists, false);
  assert.equal(flag.flavor, null);

  const ensured = await impl.ensureDebugFlag({ create: true });
  assert.equal(ensured.flagExists, false);
  assert.equal(ensured.created, false);
  assert.ok(ensured.error, 'an unsupported platform should report an error, not silently succeed');

  impl._reset(); // must not throw
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/platform.test.js`
Expected: FAIL — `Cannot find module '../lib/platform'`

- [ ] **Step 3: Implement**

`_pick('linux')` intentionally falls through to the `unsupported` stub in this phase — `lib/platform/linux.js` doesn't exist yet. Task 9 is the only place this file gets edited again, once the Linux implementation is complete; Tasks 7 and 8 build that module without connecting it, so the app is never left dispatching to a half-implemented platform.

```js
'use strict';
// Single seam between the app and OS-specific Steam detection. Every other
// module — steamSetup.js, windowFallback.js, main.js — talks to Steam only
// through this dispatcher, so `process.platform` is read exactly once, here,
// and nowhere else in the app. Adding a new OS later means adding one file
// and one line in _pick(), not hunting down every call site that used to
// branch on process.platform directly.

const win32 = require('./win32');

// Stub for any OS with no real implementation (yet). Every call resolves to
// the same "nothing detected" answer a working platform gives while Steam
// isn't running, so callers never need an extra branch for "unsupported" —
// they just see an overlay that politely never finds Steam.
const unsupported = {
  id: 'unsupported',
  findSteamPath: async () => null,
  isSteamRunning: async () => false,
  ensureDebugFlag: async () => ({
    steamPath: null,
    flagPath: null,
    flagExists: false,
    created: false,
    error: 'unsupported-platform',
    flavor: null,
  }),
  debugFlagStatus: async () => ({
    steamPath: null,
    flagPath: null,
    flagExists: false,
    flavor: null,
  }),
  getFallbackGame: async () => null,
  FLAG_NAME: win32.FLAG_NAME,
  _reset: () => {},
};

// Exported so tests can select an implementation directly instead of faking
// process.platform, which some Node builds make awkward to stub reliably.
function _pick(platformId) {
  if (platformId === 'win32') return win32;
  if (platformId === 'linux') return unsupported; // lib/platform/linux.js lands in Phase 1
  return unsupported;
}

const impl = _pick(process.platform);

module.exports = { ...impl, _pick };
```

- [ ] **Step 4: Run the test**

Run: `node --test test/platform.test.js`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add lib/platform/index.js test/platform.test.js && git commit -m "feat(platform): add platform dispatcher with unsupported-OS stub"
```

---

### Task 3: Turn `lib/steamSetup.js` into a thin delegator

> **Why:** `main.js` already imports `./lib/steamSetup` by name and calls `setup.findSteamPath()`/`isSteamRunning()`/`ensureDebugFlag()`/`debugFlagStatus()` directly. Making the facade delegate — rather than having `main.js` import `lib/platform` under a new name — keeps that import list, and the whole rest of the app, untouched while every OS-specific implementation moves behind one seam.

**Files:**
- Modify: `lib/steamSetup.js`
- Test: `test/steamSetup.test.js` (new)

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const setup = require('../lib/steamSetup');
const platform = require('../lib/platform');

test('steamSetup.js is a pure delegator to the platform dispatcher', () => {
  // Reference equality, not just "same behavior": proves main.js's calls
  // land on the exact same functions the dispatcher exposes, with no
  // reimplementation drifting out of sync in between.
  assert.strictEqual(setup.findSteamPath, platform.findSteamPath);
  assert.strictEqual(setup.isSteamRunning, platform.isSteamRunning);
  assert.strictEqual(setup.ensureDebugFlag, platform.ensureDebugFlag);
  assert.strictEqual(setup.debugFlagStatus, platform.debugFlagStatus);
  assert.strictEqual(setup._reset, platform._reset);
  assert.equal(setup.FLAG_NAME, '.cef-enable-remote-debugging');
});

test('steamSetup.js exports nothing beyond the original public surface', () => {
  assert.deepEqual(
    Object.keys(setup).sort(),
    ['FLAG_NAME', '_reset', 'debugFlagStatus', 'ensureDebugFlag', 'findSteamPath', 'isSteamRunning'].sort()
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/steamSetup.test.js`
Expected: FAIL — `AssertionError [ERR_ASSERTION]` on the first `strictEqual` (today's `steamSetup.js` defines its own independent `findSteamPath`, not a reference to `platform.findSteamPath`)

- [ ] **Step 3: Implement**

```js
'use strict';
// Thin facade kept for backward compatibility: main.js requires this exact
// path. All real logic now lives behind the platform seam in lib/platform/,
// so this file needs zero further edits when a new OS gets support — see
// lib/platform/index.js.

const platform = require('./platform');

module.exports = {
  findSteamPath: platform.findSteamPath,
  isSteamRunning: platform.isSteamRunning,
  ensureDebugFlag: platform.ensureDebugFlag,
  debugFlagStatus: platform.debugFlagStatus,
  FLAG_NAME: platform.FLAG_NAME,
  _reset: platform._reset,
};
```

This replaces the entire previous contents of `lib/steamSetup.js` (the registry/tasklist/flag-file code that now lives in `lib/platform/win32.js`).

- [ ] **Step 4: Run the test**

Run: `node --test test/steamSetup.test.js`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**

```bash
git add lib/steamSetup.js test/steamSetup.test.js && git commit -m "refactor(platform): make lib/steamSetup.js delegate to the platform dispatcher"
```

---

### Task 4: Turn `lib/windowFallback.js` into a thin delegator, keep the name-matching logic

**Files:**
- Modify: `lib/windowFallback.js`
- Test: `test/windowFallback.test.js` (add cases only — do not edit existing ones)

- [ ] **Step 1: Write the failing test**

Add to the bottom of `test/windowFallback.test.js`:

```js
test('the Windows-only helpers are re-exported from lib/platform/win32 unchanged', () => {
  const win32 = require('../lib/platform/win32');
  assert.strictEqual(f.getSteamWindowTitles, win32.getSteamWindowTitles);
  assert.strictEqual(f.titlesFromTasklist, win32.titlesFromTasklist);
  assert.strictEqual(f.parseCsvLine, win32.parseCsvLine);
});

test('getFallbackGame is delegated through the platform dispatcher', () => {
  const platform = require('../lib/platform');
  assert.strictEqual(f.getFallbackGame, platform.getFallbackGame);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/windowFallback.test.js`
Expected: FAIL — `AssertionError [ERR_ASSERTION]` (today's `windowFallback.js` still defines its own local `parseCsvLine`/`titlesFromTasklist`/`getSteamWindowTitles`/`getFallbackGame`, distinct function objects from `win32.js`'s)

- [ ] **Step 3: Implement**

```js
'use strict';
// Plan B when CDP is unavailable. isPlausibleMatch()/searchAppid() below are
// platform-neutral (any OS that ends up needing name -> appid resolution can
// reuse them) and stay defined here. The window-title probe itself is
// Windows-only and now lives in lib/platform/win32.js; it is re-exported
// unconditionally below because test/windowFallback.test.js exercises it
// directly with fixture strings regardless of which OS runs the suite.
// getFallbackGame is OS-dispatched through the platform seam so main.js
// keeps calling one function regardless of platform.

const win32 = require('./platform/win32');
const platform = require('./platform');
const log = require('./logger').scoped('fallback');

const SEARCH_TIMEOUT_MS = 6000;

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Steam's search is fuzzy and will happily return *something* for any string.
// Only accept a hit whose name actually corresponds to what we searched for,
// otherwise the overlay would confidently show the wrong game.
function isPlausibleMatch(query, name) {
  const q = normalizeName(query);
  const n = normalizeName(name);
  if (!q || !n) return false;
  return q === n || q.startsWith(n) || n.startsWith(q);
}

async function searchAppid(name) {
  if (!name) return null;
  try {
    const url = `https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(name)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr)) return null;
    for (const hit of arr) {
      if (hit && hit.appid && isPlausibleMatch(name, hit.name)) {
        return { appid: String(hit.appid), name: hit.name || name };
      }
    }
  } catch (e) {
    log.debug('app search failed', e);
  }
  return null;
}

module.exports = {
  getSteamWindowTitles: win32.getSteamWindowTitles,
  titlesFromTasklist: win32.titlesFromTasklist,
  parseCsvLine: win32.parseCsvLine,
  isPlausibleMatch,
  searchAppid,
  getFallbackGame: platform.getFallbackGame,
};
```

- [ ] **Step 4: Run the test**

Run: `node --test`
Expected: PASS — 116 tests (the original 106, plus 3 from Task 1, 6 from Task 2, 2 from Task 3, 2 from this task), 0 fail. This is the full-suite regression check for the whole phase: every pre-existing test file runs unmodified alongside the new ones.

- [ ] **Step 5: Commit**

```bash
git add lib/windowFallback.js test/windowFallback.test.js && git commit -m "refactor(platform): make lib/windowFallback.js delegate to the platform dispatcher"
```

---

## Phase 1: Linux Steam discovery

**Goal:** Teach the app to find a Steam install on Linux, tell which packaging flavor it is (native / Flatpak / Snap), know whether Steam is running, and manage the CEF remote-debugging flag file — all with zero child processes, matching the "idle-cheap" constraint the Windows implementation already committed to. Two new shared modules land here as well: a Valve KeyValues parser and a Steam-library reader, both cross-platform and both needed by later phases.

**Exit criteria:**
- [ ] `lib/vdf.js` parses `libraryfolders.vdf`, `config.vdf` and `appmanifest_*.acf` shapes, including the legacy flat library form.
- [ ] `lib/steamLibrary.js` answers "which library root owns appid N" and "what is appid N called", from disk, with no network.
- [ ] `lib/platform/linux.js` resolves a Steam root from all five real-world layouts, reports its flavor, detects a running Steam by reading `/proc` only, and creates/checks the flag file.
- [ ] `require('../lib/platform')._pick('linux')` returns the real Linux implementation, not the stub.
- [ ] `npm test` green on Windows — every new test drives injected fixture paths, never the host's real `/proc` or `$HOME`.

---

### Task 5: Add a Valve KeyValues (VDF/ACF) parser

> **Why:** Steam publishes no machine-readable index of where games live; `libraryfolders.vdf`, `config.vdf` and `appmanifest_*.acf` are the only sources, and all three use the same KeyValues text format. A ~70-line parser is cheaper and far more predictable than adding a dependency for three files.

**Files:**
- Create: `lib/vdf.js`
- Test: `test/vdf.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const vdf = require('../lib/vdf');

test('parses nested quoted key/value pairs', () => {
  const out = vdf.parse(`
"libraryfolders"
{
    "0"
    {
        "path"      "/home/user/.local/share/Steam"
        "label"     ""
        "apps"
        {
            "1245620"   "68719476736"
            "570"       "1234"
        }
    }
}
`);
  assert.equal(out.libraryfolders['0'].path, '/home/user/.local/share/Steam');
  assert.equal(out.libraryfolders['0'].label, '');
  assert.deepEqual(Object.keys(out.libraryfolders['0'].apps), ['1245620', '570']);
});

test('parses the legacy flat library form', () => {
  const out = vdf.parse(`
"LibraryFolders"
{
    "TimeNextStatsReport"   "1700000000"
    "1"     "/mnt/games/SteamLibrary"
}
`);
  assert.equal(out.LibraryFolders['1'], '/mnt/games/SteamLibrary');
});

test('skips // line comments', () => {
  const out = vdf.parse(`
// a leading comment
"root"
{
    // another one
    "key"  "value"  // trailing
}
`);
  assert.equal(out.root.key, 'value');
});

test('unescapes backslashes so Windows paths survive', () => {
  const out = vdf.parse('"root" { "path" "C:\\\\Program Files (x86)\\\\Steam" }');
  assert.equal(out.root.path, 'C:\\Program Files (x86)\\Steam');
});

test('tolerates an unbalanced closing brace without swallowing the rest', () => {
  const out = vdf.parse('"a" { "x" "1" } } "b" { "y" "2" }');
  assert.equal(out.a.x, '1');
  assert.equal(out.b.y, '2');
});

test('get() walks a path case-insensitively', () => {
  const out = vdf.parse(`
"InstallConfigStore"
{
    "Software" { "Valve" { "Steam" { "CompatToolMapping" { "570" { "name" "proton_9" } } } } }
}
`);
  assert.equal(
    vdf.get(out, ['installconfigstore', 'software', 'valve', 'steam', 'CompatToolMapping', '570', 'NAME']),
    'proton_9'
  );
  assert.equal(vdf.get(out, ['nope', 'nope']), null);
  assert.equal(vdf.get(null, ['a']), null);
});

test('returns an empty object for junk input', () => {
  assert.deepEqual(vdf.parse(''), {});
  assert.deepEqual(vdf.parse(null), {});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/vdf.test.js`
Expected: FAIL — `Cannot find module '../lib/vdf'`

- [ ] **Step 3: Implement**

```js
'use strict';
// Minimal reader for Valve's KeyValues text format — the one every .vdf and
// .acf file under a Steam install uses. Steam ships no machine-readable index
// of where games are installed, so parsing these files is the only way to
// answer "which disk is this game on" and "what is this appid called" without
// a network round trip or a child process.
//
// Deliberately not a complete KeyValues implementation: no #base/#include, no
// platform conditionals ([$WIN32]), no binary VDF. None of those appear in the
// three files this app reads, and leaving them out keeps this small enough to
// read in one sitting and trust.

const WHITESPACE = new Set([' ', '\t', '\r', '\n']);

function parse(text) {
  const src = text == null ? '' : String(text);
  const root = {};
  const stack = [root];
  let pendingKey = null;
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (WHITESPACE.has(ch)) {
      i++;
      continue;
    }

    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }

    if (ch === '{') {
      i++;
      const obj = {};
      if (pendingKey !== null) {
        stack[stack.length - 1][pendingKey] = obj;
        pendingKey = null;
      }
      // Push even for a keyless brace, so a malformed file can't unbalance the
      // stack and dump every later key into the wrong parent.
      stack.push(obj);
      continue;
    }

    if (ch === '}') {
      i++;
      if (stack.length > 1) stack.pop();
      pendingKey = null;
      continue;
    }

    let token;
    if (ch === '"') {
      i++;
      let out = '';
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length) {
          const next = src[i + 1];
          out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          i += 2;
          continue;
        }
        out += src[i];
        i++;
      }
      i++; // closing quote
      token = out;
    } else {
      const start = i;
      while (i < src.length && !WHITESPACE.has(src[i]) && !'{}"'.includes(src[i])) i++;
      token = src.slice(start, i);
      if (!token) {
        i++;
        continue;
      }
    }

    if (pendingKey === null) pendingKey = token;
    else {
      stack[stack.length - 1][pendingKey] = token;
      pendingKey = null;
    }
  }

  return root;
}

// Steam is inconsistent about key casing across client versions
// ("InstallConfigStore" vs "installconfigstore"), so every lookup that walks
// into a parsed tree goes through here rather than indexing directly.
function get(obj, keyPath) {
  let node = obj;
  for (const key of keyPath) {
    if (!node || typeof node !== 'object') return null;
    if (key in node) {
      node = node[key];
      continue;
    }
    const lower = String(key).toLowerCase();
    const hit = Object.keys(node).find((k) => k.toLowerCase() === lower);
    if (hit === undefined) return null;
    node = node[hit];
  }
  return node === undefined ? null : node;
}

module.exports = { parse, get };
```

- [ ] **Step 4: Run the test**

Run: `node --test test/vdf.test.js`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add lib/vdf.js test/vdf.test.js && git commit -m "feat: add a minimal Valve KeyValues parser"
```

---

### Task 6: Read Steam libraries and app manifests

**Files:**
- Create: `lib/steamLibrary.js`
- Test: `test/steamLibrary.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const lib = require('../lib/steamLibrary');

// Build a throwaway Steam tree: a primary library plus a second one on another
// mount, each owning one appid.
function fakeSteam({ withIndex = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sso-lib-'));
  const primary = path.join(root, 'Steam');
  const secondary = path.join(root, 'games', 'SteamLibrary');
  fs.mkdirSync(path.join(primary, 'steamapps'), { recursive: true });
  fs.mkdirSync(path.join(secondary, 'steamapps'), { recursive: true });

  fs.writeFileSync(
    path.join(primary, 'steamapps', 'appmanifest_570.acf'),
    '"AppState" { "appid" "570" "name" "Dota 2" }'
  );
  fs.writeFileSync(
    path.join(secondary, 'steamapps', 'appmanifest_427520.acf'),
    '"AppState" { "appid" "427520" "name" "Factorio" }'
  );

  if (withIndex) {
    fs.writeFileSync(
      path.join(primary, 'steamapps', 'libraryfolders.vdf'),
      `"libraryfolders"
{
  "0" { "path" "${primary.replace(/\\/g, '\\\\')}" "apps" { "570" "1" } }
  "1" { "path" "${secondary.replace(/\\/g, '\\\\')}" "apps" { "427520" "1" } }
}`
    );
  }
  return { primary, secondary };
}

test('parseLibraryFolders reads the keyed form with its apps map', () => {
  const entries = lib.parseLibraryFolders(`
"libraryfolders"
{
  "0" { "path" "/home/u/.local/share/Steam" "apps" { "570" "1" "730" "2" } }
  "1" { "path" "/mnt/games/SteamLibrary" "apps" { "427520" "3" } }
}`);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].path, '/home/u/.local/share/Steam');
  assert.deepEqual(entries[0].apps, ['570', '730']);
  assert.deepEqual(entries[1].apps, ['427520']);
});

test('parseLibraryFolders reads the legacy flat form and ignores non-numeric keys', () => {
  const entries = lib.parseLibraryFolders(`
"LibraryFolders"
{
  "TimeNextStatsReport" "1700000000"
  "ContentStatsID"      "42"
  "1"                   "/mnt/games/SteamLibrary"
}`);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, '/mnt/games/SteamLibrary');
  assert.deepEqual(entries[0].apps, []);
});

test('libraryPaths lists every root and always includes the install itself', async () => {
  lib._reset();
  const { primary, secondary } = fakeSteam();
  const roots = await lib.libraryPaths(primary);
  assert.ok(roots.includes(primary), 'primary library missing');
  assert.ok(roots.includes(secondary), 'secondary library missing');
});

test('libraryPaths falls back to the install itself when there is no index', async () => {
  lib._reset();
  const { primary } = fakeSteam({ withIndex: false });
  assert.deepEqual(await lib.libraryPaths(primary), [primary]);
});

test('libraryForAppid finds the library that owns the appid', async () => {
  lib._reset();
  const { primary, secondary } = fakeSteam();
  assert.equal(await lib.libraryForAppid(primary, '427520'), secondary);
  assert.equal(await lib.libraryForAppid(primary, 570), primary);
  assert.equal(await lib.libraryForAppid(primary, '999999'), null);
});

test('libraryForAppid falls back to probing manifests when the index has no apps map', async () => {
  lib._reset();
  const { primary, secondary } = fakeSteam();
  fs.writeFileSync(
    path.join(primary, 'steamapps', 'libraryfolders.vdf'),
    `"libraryfolders"
{
  "0" { "path" "${primary.replace(/\\/g, '\\\\')}" }
  "1" { "path" "${secondary.replace(/\\/g, '\\\\')}" }
}`
  );
  assert.equal(await lib.libraryForAppid(primary, '427520'), secondary);
});

test('appManifestName reads the display name off the manifest', async () => {
  lib._reset();
  const { primary } = fakeSteam();
  assert.equal(await lib.appManifestName(primary, '427520'), 'Factorio');
  assert.equal(await lib.appManifestName(primary, '570'), 'Dota 2');
  assert.equal(await lib.appManifestName(primary, '999999'), null);
  assert.equal(await lib.appManifestName(null, '570'), null);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/steamLibrary.test.js`
Expected: FAIL — `Cannot find module '../lib/steamLibrary'`

- [ ] **Step 3: Implement**

```js
'use strict';
// Where Steam actually keeps things on disk. Two questions the rest of the app
// asks: "which library root owns appid N" (so the free-space check measures the
// disk the game is really on, not whichever one the OS happens to live on) and
// "what is appid N called" (so a locally-detected game has a name before the
// store API answers).
//
// Cross-platform on purpose — a Windows user with a second SteamLibrary on D:
// has exactly the same problem a Linux user with /mnt/games does.

const fs = require('fs');
const path = require('path');
const vdf = require('./vdf');

const INDEX_TTL_MS = 60 * 1000; // libraries move about as often as disks do
let indexCache = new Map(); // steamPath -> { at, entries }

function indexPath(steamPath) {
  return path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
}

// Returns [{ path, apps: [appid, ...] }]. The `apps` map is absent on older
// clients and on a freshly-created index, hence the empty-array default.
function parseLibraryFolders(text) {
  const root = vdf.parse(text);
  const folders = vdf.get(root, ['libraryfolders']) || vdf.get(root, ['LibraryFolders']) || root;
  const out = [];
  if (!folders || typeof folders !== 'object') return out;

  for (const key of Object.keys(folders)) {
    if (!/^\d+$/.test(key)) continue; // TimeNextStatsReport, ContentStatsID, ...
    const entry = folders[key];
    if (typeof entry === 'string') {
      if (entry) out.push({ path: entry, apps: [] });
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const p = vdf.get(entry, ['path']);
    if (typeof p !== 'string' || !p) continue;
    const apps = vdf.get(entry, ['apps']);
    out.push({ path: p, apps: apps && typeof apps === 'object' ? Object.keys(apps) : [] });
  }
  return out;
}

async function readEntries(steamPath) {
  const hit = indexCache.get(steamPath);
  if (hit && Date.now() - hit.at < INDEX_TTL_MS) return hit.entries;
  let entries = [];
  try {
    entries = parseLibraryFolders(await fs.promises.readFile(indexPath(steamPath), 'utf8'));
  } catch {
    entries = []; // no index yet — libraryPaths() still returns the install itself
  }
  indexCache.set(steamPath, { at: Date.now(), entries });
  return entries;
}

function samePath(a, b) {
  return path.resolve(a) === path.resolve(b);
}

async function libraryPaths(steamPath) {
  if (!steamPath) return [];
  const roots = (await readEntries(steamPath)).map((e) => e.path).filter(Boolean);
  if (!roots.some((r) => samePath(r, steamPath))) roots.unshift(steamPath);
  return roots;
}

async function libraryForAppid(steamPath, appid) {
  if (!steamPath || appid == null) return null;
  const key = String(appid);

  for (const entry of await readEntries(steamPath)) {
    if (entry.apps.includes(key)) return entry.path;
  }

  // No apps map (older client, or the index predates the install): the manifest
  // file itself is the authoritative marker of which library holds the game.
  for (const root of await libraryPaths(steamPath)) {
    try {
      await fs.promises.access(path.join(root, 'steamapps', `appmanifest_${key}.acf`));
      return root;
    } catch {
      /* not in this library */
    }
  }
  return null;
}

async function appManifestName(steamPath, appid) {
  const root = await libraryForAppid(steamPath, appid);
  if (!root) return null;
  const file = path.join(root, 'steamapps', `appmanifest_${String(appid)}.acf`);
  try {
    const parsed = vdf.parse(await fs.promises.readFile(file, 'utf8'));
    const name = vdf.get(parsed, ['AppState', 'name']);
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

function _reset() {
  indexCache = new Map();
}

module.exports = { parseLibraryFolders, libraryPaths, libraryForAppid, appManifestName, _reset };
```

- [ ] **Step 4: Run the test**

Run: `node --test test/steamLibrary.test.js`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add lib/steamLibrary.js test/steamLibrary.test.js && git commit -m "feat: read Steam library folders and app manifests from disk"
```

---

### Task 7: Locate a Linux Steam install and name its flavor

> **Why:** Steam does not honour `$XDG_DATA_HOME` (still an open upstream request), and some Ubuntu `steam-installer` builds put real data straight into `~/.steam` with no symlink at all. So the test for "is this a Steam root" is `realpath` + a `steamapps` directory actually being there, never the shape of the path.

**Files:**
- Create: `lib/platform/linux.js`
- Test: `test/platformLinux.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const linux = require('../lib/platform/linux');

function fakeHome(layouts) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sso-home-'));
  for (const rel of layouts) {
    fs.mkdirSync(path.join(home, rel, 'steamapps'), { recursive: true });
  }
  return home;
}

test('prefers the native ~/.steam/steam root', async () => {
  linux._reset();
  const home = fakeHome([path.join('.steam', 'steam'), path.join('.local', 'share', 'Steam')]);
  const found = await linux.findSteamPath({ home, force: true });
  assert.equal(found, fs.realpathSync(path.join(home, '.steam', 'steam')));
  assert.equal(await linux.steamFlavor({ home }), 'native');
});

test('falls back to ~/.local/share/Steam when ~/.steam is absent', async () => {
  linux._reset();
  const home = fakeHome([path.join('.local', 'share', 'Steam')]);
  const found = await linux.findSteamPath({ home, force: true });
  assert.equal(found, fs.realpathSync(path.join(home, '.local', 'share', 'Steam')));
  assert.equal(await linux.steamFlavor({ home }), 'native');
});

test('recognises the Flatpak sandbox layout and labels it', async () => {
  linux._reset();
  const home = fakeHome([
    path.join('.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'),
  ]);
  const found = await linux.findSteamPath({ home, force: true });
  assert.ok(found && found.includes('com.valvesoftware.Steam'));
  assert.equal(await linux.steamFlavor({ home }), 'flatpak');
});

test('recognises the Snap layout and labels it', async () => {
  linux._reset();
  const home = fakeHome([path.join('snap', 'steam', 'common', '.local', 'share', 'steam')]);
  assert.ok(await linux.findSteamPath({ home, force: true }));
  assert.equal(await linux.steamFlavor({ home }), 'snap');
});

test('a directory without steamapps is not a Steam root', async () => {
  linux._reset();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sso-home-'));
  fs.mkdirSync(path.join(home, '.steam', 'steam'), { recursive: true }); // no steamapps
  assert.equal(await linux.findSteamPath({ home, force: true }), null);
  assert.equal(await linux.steamFlavor({ home }), null);
});

test('follows a symlinked ~/.steam/steam to its real target', async () => {
  linux._reset();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sso-home-'));
  const real = path.join(home, '.local', 'share', 'Steam');
  fs.mkdirSync(path.join(real, 'steamapps'), { recursive: true });
  fs.mkdirSync(path.join(home, '.steam'), { recursive: true });
  try {
    fs.symlinkSync(real, path.join(home, '.steam', 'steam'), 'dir');
  } catch {
    return; // Windows without Developer Mode cannot create symlinks; the
            // ~/.local/share/Steam case above already covers the resolution path
  }
  assert.equal(await linux.findSteamPath({ home, force: true }), fs.realpathSync(real));
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/platformLinux.test.js`
Expected: FAIL — `Cannot find module '../lib/platform/linux'`

- [ ] **Step 3: Implement**

```js
'use strict';
// Steam detection on Linux. Same three jobs as lib/platform/win32.js — find the
// install, know whether Steam is running, manage the CEF remote-debugging flag —
// with none of the same tools available.
//
// Two constraints shape everything here. First, no child processes: the
// environment loop runs every few seconds forever, and the Windows side already
// paid for learning that spawning per tick is not acceptable. Everything below
// is plain fs reads. Second, no assumptions about path shape: Steam ignores
// $XDG_DATA_HOME, some Ubuntu builds skip the ~/.steam symlink entirely, and
// Flatpak/Snap relocate the whole tree — so a candidate is only a Steam root if
// it really has a steamapps directory under it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const log = require('../logger').scoped('linux');

const FLAG_NAME = '.cef-enable-remote-debugging';
const STEAM_PATH_TTL_MS = 5 * 60 * 1000;

// Ordered by how likely they are to be the real install. The two ~/.steam
// entries are normally symlinks into the third; they come first because a
// distro that does use them keeps them correct across reinstalls.
const CANDIDATES = [
  { rel: ['.steam', 'steam'], flavor: 'native' },
  { rel: ['.steam', 'root'], flavor: 'native' },
  { rel: ['.local', 'share', 'Steam'], flavor: 'native' },
  { rel: ['.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'], flavor: 'flatpak' },
  { rel: ['snap', 'steam', 'common', '.local', 'share', 'steam'], flavor: 'snap' },
];

let cache = { at: 0, steamPath: null, flavor: null, home: null };

function locate(home) {
  for (const candidate of CANDIDATES) {
    const guess = path.join(home, ...candidate.rel);
    let resolved;
    try {
      resolved = fs.realpathSync(guess);
    } catch {
      continue; // missing, or a symlink pointing nowhere
    }
    try {
      if (!fs.statSync(path.join(resolved, 'steamapps')).isDirectory()) continue;
    } catch {
      continue;
    }
    return { steamPath: resolved, flavor: candidate.flavor };
  }
  return { steamPath: null, flavor: null };
}

function resolveSteam({ home = os.homedir(), force = false } = {}) {
  const now = Date.now();
  if (!force && cache.home === home && now - cache.at < STEAM_PATH_TTL_MS) return cache;
  const found = locate(home);
  cache = { at: now, home, steamPath: found.steamPath, flavor: found.flavor };
  if (found.steamPath) log.debug('steam path', found.steamPath, `(${found.flavor})`);
  return cache;
}

async function findSteamPath(opts = {}) {
  return resolveSteam(opts).steamPath;
}

// Exposed separately so the UI can warn that Flatpak/Snab Steam are best-effort:
// a flag file written outside the sandbox is invisible to the sandboxed client,
// which is exactly why the candidates above target each sandbox's own root.
async function steamFlavor(opts = {}) {
  return resolveSteam(opts).flavor;
}

function _reset() {
  cache = { at: 0, steamPath: null, flavor: null, home: null };
}

module.exports = { findSteamPath, steamFlavor, FLAG_NAME, _reset };
```

Fix the typo in the comment while writing it — `Snab` should read `Snap`.

- [ ] **Step 4: Run the test**

Run: `node --test test/platformLinux.test.js`
Expected: PASS — 6 tests (the symlink case self-skips on a Windows box without Developer Mode)

- [ ] **Step 5: Commit**

```bash
git add lib/platform/linux.js test/platformLinux.test.js && git commit -m "feat(linux): locate the Steam install across native, Flatpak and Snap layouts"
```

---

### Task 8: Detect a running Steam by reading /proc only

> **Why:** The Windows path spawns `tasklist` and the codebase already documents the cost of doing that every 3 s forever. Linux exposes the same answer as plain files, so the Linux implementation spawns nothing at all — `/proc/<pid>/comm` is a one-line read, and `steam`/`steamwebhelper` both fit inside the kernel's 15-character `comm` limit, so exact string comparison is safe.

**Files:**
- Modify: `lib/platform/linux.js`
- Test: `test/platformLinux.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/platformLinux.test.js`:

```js
// A stand-in /proc: one directory per pid, each with the `comm` and `cmdline`
// files this code actually reads. Keeps the test honest on a Windows box.
function fakeProc(procs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sso-proc-'));
  for (const [pid, { comm, cmdline }] of Object.entries(procs)) {
    const dir = path.join(root, pid);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'comm'), `${comm}\n`);
    if (cmdline !== undefined) fs.writeFileSync(path.join(dir, 'cmdline'), cmdline);
  }
  fs.mkdirSync(path.join(root, 'self'), { recursive: true }); // non-numeric entry
  return root;
}

test('isSteamRunning is true when the steam process is present', async () => {
  linux._reset();
  const procRoot = fakeProc({ 1: { comm: 'systemd' }, 4211: { comm: 'steam' } });
  assert.equal(await linux.isSteamRunning({ procRoot, maxAgeMs: 0 }), true);
});

test('isSteamRunning is true for steamwebhelper alone', async () => {
  linux._reset();
  const procRoot = fakeProc({ 4300: { comm: 'steamwebhelper' } });
  assert.equal(await linux.isSteamRunning({ procRoot, maxAgeMs: 0 }), true);
});

test('isSteamRunning is false when nothing Steam-shaped is running', async () => {
  linux._reset();
  const procRoot = fakeProc({ 1: { comm: 'systemd' }, 900: { comm: 'firefox' } });
  assert.equal(await linux.isSteamRunning({ procRoot, maxAgeMs: 0 }), false);
});

test('isSteamRunning is false when /proc cannot be read at all', async () => {
  linux._reset();
  assert.equal(
    await linux.isSteamRunning({ procRoot: path.join(os.tmpdir(), 'sso-no-such-proc'), maxAgeMs: 0 }),
    false
  );
});

test('isSteamRunning does not match a process merely named like steam', async () => {
  linux._reset();
  const procRoot = fakeProc({ 500: { comm: 'steamlink' }, 501: { comm: 'steam-runtime' } });
  assert.equal(await linux.isSteamRunning({ procRoot, maxAgeMs: 0 }), false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/platformLinux.test.js`
Expected: FAIL — `linux.isSteamRunning is not a function`

- [ ] **Step 3: Implement**

Add to `lib/platform/linux.js`, above `_reset`:

```js
const PROC_ROOT = '/proc';
const RUNNING_TTL_MS = 4000;
const STEAM_COMMS = new Set(['steam', 'steamwebhelper']);

let runningCache = { value: false, at: 0 };

// One pass over /proc answering everything we need from the process table.
// Every per-pid read is guarded individually: a pid disappearing between the
// readdir and the read is routine on a busy machine, not an error worth logging.
function scanProc(procRoot) {
  const out = { running: false, steamCwd: null, appids: [] };
  let pids;
  try {
    pids = fs.readdirSync(procRoot);
  } catch {
    return out;
  }

  for (const pid of pids) {
    if (!/^\d+$/.test(pid)) continue;
    let comm;
    try {
      comm = fs.readFileSync(path.join(procRoot, pid, 'comm'), 'utf8').trim();
    } catch {
      continue;
    }

    if (STEAM_COMMS.has(comm)) {
      out.running = true;
      // Flatpak-sandboxed Steam is visible here with the right comm (pid
      // namespaces are hierarchical), but its /proc/<pid>/exe resolves inside a
      // private mount namespace and is useless from outside. cwd still is not.
      if (comm === 'steam' && out.steamCwd === null) {
        try {
          out.steamCwd = fs.readlinkSync(path.join(procRoot, pid, 'cwd'));
        } catch {
          /* sandboxed or permission-denied — the path candidates cover us */
        }
      }
      continue;
    }

    if (comm !== 'reaper') continue;
    let cmdline;
    try {
      cmdline = fs.readFileSync(path.join(procRoot, pid, 'cmdline'), 'utf8');
    } catch {
      continue;
    }
    const appid = appidFromReaperCmdline(cmdline);
    if (appid) out.appids.push(appid);
  }
  return out;
}

// Steam launches every game through a `reaper` supervisor whose argv carries
// the appid verbatim:
//   reaper\0SteamLaunch\0AppId=730\0--\0steam-launch-wrapper\0
// Exact, no fuzzy name matching, no network round trip.
function appidFromReaperCmdline(cmdline) {
  if (!cmdline) return null;
  const args = String(cmdline).split('\0');
  if (!args.includes('SteamLaunch')) return null;
  for (const arg of args) {
    const m = /^AppId=(\d+)$/.exec(arg);
    if (m) return m[1];
  }
  return null;
}

async function isSteamRunning({ maxAgeMs = RUNNING_TTL_MS, procRoot = PROC_ROOT } = {}) {
  const now = Date.now();
  if (maxAgeMs > 0 && now - runningCache.at < maxAgeMs) return runningCache.value;
  const value = scanProc(procRoot).running;
  runningCache = { value, at: now };
  return value;
}
```

Extend `_reset` and the exports:

```js
function _reset() {
  cache = { at: 0, steamPath: null, flavor: null, home: null };
  runningCache = { value: false, at: 0 };
}

module.exports = {
  findSteamPath,
  steamFlavor,
  isSteamRunning,
  scanProc,
  appidFromReaperCmdline,
  FLAG_NAME,
  _reset,
};
```

- [ ] **Step 4: Run the test**

Run: `node --test test/platformLinux.test.js`
Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
git add lib/platform/linux.js test/platformLinux.test.js && git commit -m "feat(linux): detect a running Steam from /proc without spawning anything"
```

---

### Task 9: Manage the CEF flag file and wire Linux into the dispatcher

**Files:**
- Modify: `lib/platform/linux.js`
- Modify: `lib/platform/index.js`
- Test: `test/platformLinux.test.js`, `test/platform.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/platformLinux.test.js`:

```js
test('debugFlagStatus reports the flag path and flavor without creating anything', async () => {
  linux._reset();
  const home = fakeHome([path.join('.steam', 'steam')]);
  const status = await linux.debugFlagStatus({ home });
  assert.equal(status.flagExists, false);
  assert.equal(status.flavor, 'native');
  assert.equal(path.basename(status.flagPath), '.cef-enable-remote-debugging');
  assert.equal(fs.existsSync(status.flagPath), false, 'status must not create the flag');
});

test('ensureDebugFlag creates the flag once and reports it thereafter', async () => {
  linux._reset();
  const home = fakeHome([path.join('.local', 'share', 'Steam')]);
  const first = await linux.ensureDebugFlag({ create: true, home });
  assert.equal(first.created, true);
  assert.equal(first.flagExists, true);
  assert.equal(first.error, null);
  assert.equal(fs.readFileSync(first.flagPath, 'utf8'), '');

  linux._reset();
  const second = await linux.ensureDebugFlag({ create: true, home });
  assert.equal(second.created, false);
  assert.equal(second.flagExists, true);
});

test('ensureDebugFlag reports steam-not-found rather than guessing a path', async () => {
  linux._reset();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sso-home-'));
  const res = await linux.ensureDebugFlag({ create: true, home });
  assert.equal(res.steamPath, null);
  assert.equal(res.flagExists, false);
  assert.equal(res.error, 'steam-not-found');
  assert.equal(res.flavor, null);
});
```

Append to `test/platform.test.js`:

```js
test('_pick resolves linux to the real Linux implementation', () => {
  const platform = require('../lib/platform');
  const impl = platform._pick('linux');
  assert.equal(impl.id, 'linux');
  for (const key of CONTRACT_KEYS) assert.ok(key in impl, `linux impl missing "${key}"`);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/platformLinux.test.js test/platform.test.js`
Expected: FAIL — `linux.debugFlagStatus is not a function`, and `expected 'unsupported' to equal 'linux'`

- [ ] **Step 3: Implement**

Add to `lib/platform/linux.js`:

```js
// Returns { steamPath, flagPath, flagExists, created, error, flavor }.
// Millennium (the Steam theming framework) is known to delete this file on every
// Steam launch, so callers must keep re-checking rather than assuming the flag
// survives once written — which is why the environment loop calls
// debugFlagStatus() on a timer instead of caching a single answer.
async function ensureDebugFlag({ create = true, home, force = true } = {}) {
  const { steamPath, flavor } = resolveSteam({ home, force });
  if (!steamPath) {
    return {
      steamPath: null,
      flagPath: null,
      flagExists: false,
      created: false,
      error: 'steam-not-found',
      flavor: null,
    };
  }
  const flagPath = path.join(steamPath, FLAG_NAME);
  let flagExists = fs.existsSync(flagPath);
  let created = false;
  if (!flagExists && create) {
    try {
      fs.writeFileSync(flagPath, '');
      flagExists = true;
      created = true;
      log.info('created cef debug flag at', flagPath);
    } catch (e) {
      log.error('could not create debug flag', e);
      return { steamPath, flagPath, flagExists: false, created: false, error: e.message, flavor };
    }
  }
  return { steamPath, flagPath, flagExists, created, error: null, flavor };
}

async function debugFlagStatus({ home } = {}) {
  const { steamPath, flavor } = resolveSteam({ home });
  if (!steamPath) return { steamPath: null, flagPath: null, flagExists: false, flavor: null };
  const flagPath = path.join(steamPath, FLAG_NAME);
  return { steamPath, flagPath, flagExists: fs.existsSync(flagPath), flavor };
}
```

Add `id` and the new functions to the exports (`getFallbackGame` lands in Task 11 — export the placeholder now so the dispatcher contract is complete from the moment it is wired):

```js
module.exports = {
  id: 'linux',
  findSteamPath,
  steamFlavor,
  isSteamRunning,
  ensureDebugFlag,
  debugFlagStatus,
  getFallbackGame: async () => null, // replaced in Phase 2, Task 11
  scanProc,
  appidFromReaperCmdline,
  FLAG_NAME,
  _reset,
};
```

Then in `lib/platform/index.js`, replace the stub line:

```js
// before
  if (platformId === 'linux') return unsupported; // lib/platform/linux.js lands in Phase 1

// after
  if (platformId === 'linux') return require('./linux');
```

- [ ] **Step 4: Run the tests**

Run: `node --test`
Expected: PASS — full suite green, including the new `test/platformLinux.test.js` (14 tests) and the extended `test/platform.test.js` (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/platform/linux.js lib/platform/index.js test/platformLinux.test.js test/platform.test.js && git commit -m "feat(linux): manage the CEF debug flag and wire Linux into the platform dispatcher"
```

---

## Phase 2: Linux game detection

**Goal:** Make the overlay answer "which game" on Linux. The CDP path — `lib/steamDebug.js` — needs **no changes at all**: Linux Steam is the same CEF build, listening on the same `127.0.0.1:8080`, serving the same `/json` target list. Do not "port" it. What does change is the fallback: the Windows window-title scrape has no Linux equivalent worth building, and is replaced by a strictly better signal read from `/proc`.

**Exit criteria:**
- [ ] `lib/steamDebug.js` is byte-identical to its state at the end of Phase 1.
- [ ] `getFallbackGame()` on Linux returns an exact appid from the `reaper` process, with a title resolved locally from the app manifest.
- [ ] The game object carries `kind: 'running'` on that path, and the UI labels it distinctly from CDP's `store` / `library`.
- [ ] `npm run verify` green on Windows.

---

### Task 10: Return the running game from the reaper process

> **Why:** On Windows the fallback reads window titles and then asks Steam's search endpoint to turn a name into an appid — fuzzy, network-dependent, and dead on Wayland, which forbids cross-application window enumeration by design. Linux's `reaper` supervisor hands over the numeric appid directly, so the Linux fallback is both simpler and more accurate than the one it replaces. It answers a different question, though: Windows' fallback reports what the user is *viewing*, this reports what they are *playing*.

**Files:**
- Modify: `lib/platform/linux.js`
- Test: `test/platformLinux.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/platformLinux.test.js`:

```js
const REAPER_CMDLINE =
  '/home/u/.local/share/Steam/ubuntu12_32/reaper\0SteamLaunch\0AppId=427520\0--\0' +
  '/home/u/.local/share/Steam/ubuntu12_32/steam-launch-wrapper\0';

test('appidFromReaperCmdline pulls the appid out of the launch arguments', () => {
  assert.equal(linux.appidFromReaperCmdline(REAPER_CMDLINE), '427520');
  assert.equal(linux.appidFromReaperCmdline('/usr/bin/reaper\0--help\0'), null);
  assert.equal(linux.appidFromReaperCmdline(''), null);
  assert.equal(linux.appidFromReaperCmdline(null), null);
});

test('appidFromReaperCmdline ignores an AppId that is not a launch', () => {
  // A reaper with no SteamLaunch marker is supervising something else.
  assert.equal(linux.appidFromReaperCmdline('/usr/bin/reaper\0AppId=730\0'), null);
});

test('getFallbackGame reports the running appid with its local name', async () => {
  linux._reset();
  require('../lib/steamLibrary')._reset();

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sso-home-'));
  const steam = path.join(home, '.local', 'share', 'Steam');
  fs.mkdirSync(path.join(steam, 'steamapps'), { recursive: true });
  fs.writeFileSync(
    path.join(steam, 'steamapps', 'appmanifest_427520.acf'),
    '"AppState" { "appid" "427520" "name" "Factorio" }'
  );
  const procRoot = fakeProc({ 4211: { comm: 'steam' }, 5000: { comm: 'reaper', cmdline: REAPER_CMDLINE } });

  const game = await linux.getFallbackGame({ home, procRoot });
  assert.deepEqual(game, { appid: '427520', title: 'Factorio', kind: 'running' });
});

test('getFallbackGame still reports the appid when no manifest names it', async () => {
  linux._reset();
  require('../lib/steamLibrary')._reset();
  const home = fakeHome([path.join('.local', 'share', 'Steam')]);
  const procRoot = fakeProc({ 5000: { comm: 'reaper', cmdline: REAPER_CMDLINE } });

  const game = await linux.getFallbackGame({ home, procRoot });
  assert.equal(game.appid, '427520');
  assert.equal(game.title, null); // the store API fills this in downstream
  assert.equal(game.kind, 'running');
});

test('getFallbackGame returns null when no game is running', async () => {
  linux._reset();
  const procRoot = fakeProc({ 4211: { comm: 'steam' } });
  assert.equal(await linux.getFallbackGame({ home: fakeHome([]), procRoot }), null);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/platformLinux.test.js`
Expected: FAIL — `expected null to deeply equal { appid: '427520', title: 'Factorio', kind: 'running' }`

- [ ] **Step 3: Implement**

Add to `lib/platform/linux.js` (and add `const steamLibrary = require('../steamLibrary');` to the requires at the top):

```js
// Plan B when CDP is unavailable. Unlike the Windows fallback, this cannot tell
// you what the user is *browsing* — nothing on Linux persists the store tab's
// URL, and registry.vdf's RunningAppID has been stuck at 0 since a 2023 client
// change (ValveSoftware/steam-for-linux#9672, still open). What it can tell you,
// exactly and for free, is what is *running*. `kind: 'running'` marks that
// difference so the UI can be honest about it.
async function getFallbackGame({ home, procRoot = PROC_ROOT } = {}) {
  const { appids } = scanProc(procRoot);
  if (appids.length === 0) return null;
  const appid = appids[0];

  // Name it from the on-disk manifest so the header has something real before
  // the store API answers. No network fallback is needed here: unlike Windows,
  // we already hold the appid, and lib/steamApi.js fills the title in anyway.
  const { steamPath } = resolveSteam({ home });
  const title = steamPath ? await steamLibrary.appManifestName(steamPath, appid) : null;
  return { appid, title, kind: 'running' };
}
```

Replace the placeholder in the exports:

```js
// before
  getFallbackGame: async () => null, // replaced in Phase 2, Task 11

// after
  getFallbackGame,
```

- [ ] **Step 4: Run the test**

Run: `node --test test/platformLinux.test.js`
Expected: PASS — 19 tests

- [ ] **Step 5: Commit**

```bash
git add lib/platform/linux.js test/platformLinux.test.js && git commit -m "feat(linux): detect the running game from the Steam reaper process"
```

---

### Task 11: Carry the flavor into app state and label the running-game source

**Files:**
- Modify: `main.js:49-69` (state), `main.js:189-231` (`envTick`)
- Modify: `renderer.js:667-674`
- Test: `test/platformLinux.test.js` (no new cases — this task is wiring; verification is by hand plus the full suite)

- [ ] **Step 1: Add `steamFlavor` to the state shape**

In `main.js`, inside the `state` object, after the `flagExists` line:

```js
  flagExists: false,
  steamFlavor: null, // 'windows' | 'native' | 'flatpak' | 'snap' — Flatpak/Snap Steam are best-effort
```

- [ ] **Step 2: Populate it from the flag status**

In `envTick`, replace the three assignments after the `Promise.all`:

```js
    // before
    state.steamRunning = running;
    state.steamPath = flag.steamPath;
    state.flagExists = flag.flagExists;

    // after
    state.steamRunning = running;
    state.steamPath = flag.steamPath;
    state.flagExists = flag.flagExists;
    state.steamFlavor = flag.flavor;
```

And in the `enableDebug` IPC handler, after `state.steamPath = res.steamPath;`:

```js
  state.steamFlavor = res.flavor;
```

- [ ] **Step 3: Label the running-game source in the renderer**

In `renderer.js`, replace the `srcTag` expression:

```js
  // before
  const srcTag =
    state.game.source === 'fallback'
      ? ' · fallback'
      : state.game.kind === 'library'
        ? ' · biblioteca'
        : '';

  // after
  const srcTag =
    state.game.kind === 'running'
      ? ' · em execução'
      : state.game.source === 'fallback'
        ? ' · fallback'
        : state.game.kind === 'library'
          ? ' · biblioteca'
          : '';
```

- [ ] **Step 4: Verify nothing regressed**

Run: `node --test`
Expected: PASS — full suite green, same count as after Task 10.

Then confirm the state shape by hand:

Run: `node -e "const s=require('fs').readFileSync('main.js','utf8'); console.log(s.includes('steamFlavor: null'), s.includes('state.steamFlavor = flag.flavor'), s.includes('state.steamFlavor = res.flavor'))"`
Expected: `true true true`

- [ ] **Step 5: Commit**

```bash
git add main.js renderer.js && git commit -m "feat(linux): surface the Steam packaging flavor and the running-game source"
```

---

### Phase 2 verification

**Files:**
- No changes — this is a checkpoint.

- [ ] **Step 1: Full quality gate on Windows**

Run: `npm run verify`
Expected: three stages in order — `validate-tables.js` printing its table-coverage summary with no `MISSING` lines, `selfcheck.js` printing its end-to-end parse→compare→extras walkthrough and exiting 0, then `node --test` reporting `pass` equal to the total and `fail 0`. Any non-zero exit means stop and fix before moving to Phase 3.

- [ ] **Step 2: Confirm the CDP module was never touched**

Run: `git diff --stat main..HEAD -- lib/steamDebug.js`
Expected: empty output. `lib/steamDebug.js` is unchanged by Phases 0–2 by design — Linux Steam speaks the identical protocol on the identical port.

- [ ] **Step 3: Confirm the platform seam is the only place reading `process.platform`**

Run: `git grep -n "process.platform" -- "*.js" ":!node_modules"`
Expected: exactly one hit, `lib/platform/index.js`.

- [ ] **Step 4: Hand-check on a real Linux box (no Linux CI exists yet at this point)**

Run the app from source with `npm start` on a native-package Steam install and confirm:

- [ ] With Steam closed, the overlay shows the "Steam não está aberta" state — proving the `/proc` scan reports false correctly rather than defaulting to true.
- [ ] With Steam open and no flag file, the overlay shows the setup state and the "Ativar debug" button reports a real path under `~/.steam/steam` or `~/.local/share/Steam` (not a Windows-shaped guess, not null).
- [ ] Pressing the button creates the file: `ls -la ~/.steam/steam/.cef-enable-remote-debugging` shows a 0-byte file.
- [ ] After restarting Steam, `curl -s http://127.0.0.1:8080/json | head -c 200` returns a JSON array, and opening a store page in Steam makes the overlay show that game with no `· fallback` tag.
- [ ] Launching any installed game and killing the CDP path (close and reopen Steam *without* the flag) makes the overlay show the running game with the `· em execução` tag and the correct name from the manifest.
- [ ] `top -b -n 1 | grep -c "reg\|tasklist"` stays at 0 and the app's own CPU time stays flat while idle — the `/proc` scan must not show up as measurable load.

- [ ] **Step 5: Hand-check the non-native layouts, best-effort**

- [ ] Flatpak Steam (`flatpak install flathub com.valvesoftware.Steam`): the overlay resolves `~/.var/app/com.valvesoftware.Steam/.local/share/Steam` and reports flavor `flatpak`. CDP may still not come up — that is expected and documented, not a bug to chase here.
- [ ] Snap Steam: resolves `~/snap/steam/common/.local/share/steam`, flavor `snap`, same caveat.

---

## Phase 3: Hardware detection on Linux

**Goal:** Make `detectSpecs()` describe a Linux machine as accurately as it describes a Windows one. Most of it already works — `systeminformation` funnels Linux CPU strings through the same normalizer as Windows, so `cleanDeviceName()` and the CPU assembly need no change at all. Three things genuinely break: the integrated-vs-dedicated GPU heuristic misclassifies AMD APUs, VRAM is silently under-reported for non-NVIDIA cards, and the free-space check picks the wrong disk. Two things go missing rather than break: the OS and DirectX rows have nothing to say.

**Exit criteria:**
- [ ] `detectSpecs()` returns `platform`, `kernel`, `distroDisplay`, `vulkanVersion`.
- [ ] `pickGpu()` classifies real Linux `lspci` strings correctly, including AMD APUs, with every existing Windows-shaped assertion still passing.
- [ ] VRAM that cannot be trusted is reported as `null` rather than as a wrong number.
- [ ] Free space is measured on the disk the game's Steam library lives on.
- [ ] The `SO` and `DirectX` extras chips are replaced on Linux by Proton- and Vulkan-framed equivalents; `renderExtras` needs no change to render them.

---

### Task 12: Report the platform, kernel and distro

**Files:**
- Modify: `lib/detectSpecs.js:92-150`
- Test: `test/detectSpecs.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/detectSpecs.test.js`:

```js
test('distroDisplay joins the distro name and version', () => {
  assert.equal(d.distroDisplayFrom('Ubuntu', '24.04'), 'Ubuntu 24.04');
  assert.equal(d.distroDisplayFrom('Fedora Linux', '41'), 'Fedora Linux 41');
});

test('distroDisplay drops a version Steam-less rolling distros do not publish', () => {
  assert.equal(d.distroDisplayFrom('Arch Linux', 'unknown'), 'Arch Linux');
  assert.equal(d.distroDisplayFrom('Arch Linux', ''), 'Arch Linux');
  assert.equal(d.distroDisplayFrom('Arch Linux', null), 'Arch Linux');
});

test('distroDisplay is null when there is no distro at all', () => {
  assert.equal(d.distroDisplayFrom(null, '24.04'), null);
  assert.equal(d.distroDisplayFrom('', ''), null);
});

test('distroDisplay does not repeat a version already in the name', () => {
  assert.equal(d.distroDisplayFrom('Ubuntu 24.04 LTS', '24.04'), 'Ubuntu 24.04 LTS');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/detectSpecs.test.js`
Expected: FAIL — `d.distroDisplayFrom is not a function`

- [ ] **Step 3: Implement**

In `lib/detectSpecs.js`, add after `directXForWindows`:

```js
// The Linux counterpart to windowsVersionFrom: si.osInfo() gives `distro` from
// /etc/os-release's NAME and `release` from VERSION_ID. Rolling distros publish
// no VERSION_ID, and systeminformation surfaces that as the literal string
// 'unknown' — printing "Arch Linux unknown" would look like a bug, so drop it.
function distroDisplayFrom(distro, release) {
  const name = String(distro || '').trim();
  if (!name) return null;
  const version = String(release || '').trim();
  if (!version || version.toLowerCase() === 'unknown') return name;
  if (name.includes(version)) return name; // "Ubuntu 24.04 LTS" already says it
  return `${name} ${version}`;
}
```

Add the three new fields to the `out` object in `probe()`, next to `osRelease`:

```js
    osName: null,
    osRelease: null,
    platform: process.platform === 'linux' ? 'linux' : 'win32',
    kernel: null,
    distroDisplay: null,
    windowsVersion: null,
```

And populate them inside the `if (os) { ... }` branch, after `out.arch = os.arch || process.arch;`:

```js
      out.kernel = os.kernel || null;
      out.distroDisplay = distroDisplayFrom(os.distro, os.release);
```

Add `distroDisplayFrom` to `module.exports`.

- [ ] **Step 4: Run the test**

Run: `node --test test/detectSpecs.test.js`
Expected: PASS — 14 tests

- [ ] **Step 5: Commit**

```bash
git add lib/detectSpecs.js test/detectSpecs.test.js && git commit -m "feat(linux): report platform, kernel and distro in detected specs"
```

---

### Task 13: Read the Vulkan API version from ICD manifests

**Files:**
- Create: `lib/vulkan.js`
- Test: `test/vulkan.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const vulkan = require('../lib/vulkan');

test('parseIcdManifest reduces the declared version to major.minor', () => {
  assert.equal(vulkan.parseIcdManifest('{"ICD":{"api_version":"1.3.280"}}'), 1.3);
  assert.equal(vulkan.parseIcdManifest('{"ICD":{"api_version":"1.2.198"}}'), 1.2);
  assert.equal(vulkan.parseIcdManifest('{"ICD":{"api_version":"1.4.0"}}'), 1.4);
});

test('parseIcdManifest ignores anything that is not an ICD manifest', () => {
  assert.equal(vulkan.parseIcdManifest('{"layer":{"name":"VK_LAYER_x"}}'), null);
  assert.equal(vulkan.parseIcdManifest('{"ICD":{"library_path":"x.so"}}'), null);
  assert.equal(vulkan.parseIcdManifest('not json at all'), null);
  assert.equal(vulkan.parseIcdManifest(''), null);
});

test('readIcdVersion takes the highest version across every installed driver', () => {
  vulkan._reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sso-icd-'));
  fs.writeFileSync(path.join(dir, 'intel_icd.x86_64.json'), '{"ICD":{"api_version":"1.2.198"}}');
  fs.writeFileSync(path.join(dir, 'radeon_icd.x86_64.json'), '{"ICD":{"api_version":"1.3.280"}}');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');
  assert.equal(vulkan.readIcdVersion([dir]), 1.3);
});

test('readIcdVersion is null when no driver declares anything', () => {
  vulkan._reset();
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sso-icd-'));
  assert.equal(vulkan.readIcdVersion([empty]), null);
  assert.equal(vulkan.readIcdVersion([path.join(os.tmpdir(), 'sso-no-such-icd-dir')]), null);
  assert.equal(vulkan.readIcdVersion([]), null);
});

test('readIcdVersion survives a malformed manifest sitting next to a good one', () => {
  vulkan._reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sso-icd-'));
  fs.writeFileSync(path.join(dir, 'broken_icd.json'), '{ this is not json');
  fs.writeFileSync(path.join(dir, 'nvidia_icd.json'), '{"ICD":{"api_version":"1.3.277"}}');
  assert.equal(vulkan.readIcdVersion([dir]), 1.3);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/vulkan.test.js`
Expected: FAIL — `Cannot find module '../lib/vulkan'`

- [ ] **Step 3: Implement**

```js
'use strict';
// What Vulkan level this machine's graphics drivers declare. On Linux this is
// the number that actually matters for a Windows game running through Proton:
// DXVK and VKD3D-Proton translate Direct3D calls to Vulkan, so the DirectX
// version a store page asks for is really a question about Vulkan here.
//
// Read from the driver's own ICD manifest rather than by running `vulkaninfo`,
// which lives in a separate vulkan-tools package most users do not have
// installed. Same epistemic status the Windows DirectX number already carries —
// per lib/detectSpecs.js, "reported as guidance, never as a hard fail": this is
// the driver's declared maximum, not a version negotiated with a live device.

const fs = require('fs');
const path = require('path');

const ICD_DIRS = ['/usr/share/vulkan/icd.d', '/etc/vulkan/icd.d'];

let cached; // undefined = not probed yet, null = probed and found nothing

function parseIcdManifest(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const raw = json && json.ICD && json.ICD.api_version;
  if (typeof raw !== 'string') return null;
  const m = /^(\d+)\.(\d+)/.exec(raw.trim());
  if (!m) return null;
  const v = parseFloat(`${m[1]}.${m[2]}`);
  return isFinite(v) ? v : null;
}

// A machine can have several drivers installed at once (an Intel iGPU manifest
// alongside a discrete NVIDIA one). The highest declared version is the one the
// card a game will actually run on supports.
function readIcdVersion(dirs = ICD_DIRS) {
  let best = null;
  for (const dir of dirs) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      let text;
      try {
        text = fs.readFileSync(path.join(dir, name), 'utf8');
      } catch {
        continue;
      }
      const v = parseIcdManifest(text);
      if (v != null && (best == null || v > best)) best = v;
    }
  }
  return best;
}

function version() {
  if (cached === undefined) cached = readIcdVersion();
  return cached;
}

function _reset() {
  cached = undefined;
}

module.exports = { version, readIcdVersion, parseIcdManifest, _reset };
```

- [ ] **Step 4: Run the test**

Run: `node --test test/vulkan.test.js`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add lib/vulkan.js test/vulkan.test.js && git commit -m "feat(linux): read the Vulkan API version from driver ICD manifests"
```

---

### Task 14: Put the Vulkan version into detected specs

**Files:**
- Modify: `lib/detectSpecs.js`
- Test: `test/detectSpecs.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/detectSpecs.test.js`:

```js
test('probe() exposes a vulkanVersion field on every platform', async () => {
  d._reset();
  const out = await d.probe();
  assert.ok('vulkanVersion' in out, 'probe() must always declare vulkanVersion');
  assert.ok(
    out.vulkanVersion === null || typeof out.vulkanVersion === 'number',
    `vulkanVersion must be a number or null, got ${typeof out.vulkanVersion}`
  );
  // On Windows there are no ICD manifests to read, so it must be null there.
  if (process.platform === 'win32') assert.equal(out.vulkanVersion, null);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/detectSpecs.test.js`
Expected: FAIL — `probe() must always declare vulkanVersion`

- [ ] **Step 3: Implement**

In `lib/detectSpecs.js`, add the require at the top next to the others:

```js
const vulkan = require('./vulkan');
```

Add the field to the `out` object in `probe()`, after `directX: null,`:

```js
    directX: null,
    vulkanVersion: null,
```

And populate it at the end of the `try` block, just before `out.freeDiskGB = pickSystemDisk(fs);`:

```js
    // Only meaningful on Linux — Windows has no ICD manifest directory, so this
    // reads nothing and stays null there rather than needing a platform branch.
    out.vulkanVersion = vulkan.version();
```

- [ ] **Step 4: Run the test**

Run: `node --test test/detectSpecs.test.js`
Expected: PASS — 15 tests

- [ ] **Step 5: Commit**

```bash
git add lib/detectSpecs.js test/detectSpecs.test.js && git commit -m "feat(linux): carry the Vulkan version through detected specs"
```

---

### Task 15: Fix the integrated-GPU heuristic for Linux driver strings

> **Why:** This is a correctness bug, not polish. On Linux `si.graphics()` builds the model string from `lspci`, which names AMD APUs `Picasso/Raven 2 [Radeon Vega Series / Radeon Vega Mobile Series]` — no "graphics", and no digit after "Vega". Both existing integrated tests miss it, so `pickGpu()` ranks an APU as a dedicated card and every comparison on that machine is wrong.

**Files:**
- Modify: `lib/detectSpecs.js:17-38`
- Test: `test/detectSpecs.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/detectSpecs.test.js`:

```js
test('pickGpu treats an AMD APU named the way lspci names it as integrated', () => {
  const g = d.pickGpu([
    {
      vendor: 'Advanced Micro Devices, Inc. [AMD/ATI]',
      model: 'Picasso/Raven 2 [Radeon Vega Series / Radeon Vega Mobile Series]',
      vram: 512,
    },
    { vendor: 'NVIDIA Corporation', model: 'GA107M [GeForce RTX 3050 Mobile]', vram: 4096 },
  ]);
  assert.equal(g.model, 'GA107M [GeForce RTX 3050 Mobile]');
});

test('pickGpu recognises the newer AMD APU codenames lspci reports', () => {
  for (const model of [
    'Renoir [Radeon Vega Series]',
    'Cezanne [Radeon Vega Series]',
    'Rembrandt [Radeon 680M]',
    'Phoenix1',
    'Strix [Radeon 880M]',
    'Barcelo [Radeon Vega Series]',
    'Lucienne [Radeon Vega Series]',
    'Van Gogh [AMD Custom GPU 0405]',
  ]) {
    const g = d.pickGpu([
      { vendor: 'Advanced Micro Devices, Inc. [AMD/ATI]', model, vram: 512 },
      { vendor: 'NVIDIA Corporation', model: 'GA104 [GeForce RTX 3070]', vram: 8192 },
    ]);
    assert.equal(g.model, 'GA104 [GeForce RTX 3070]', `${model} should rank as integrated`);
  }
});

test('pickGpu keeps ranking real dedicated cards as dedicated on Linux strings', () => {
  const amd = d.pickGpu([
    { vendor: 'Intel Corporation', model: 'Raptor Lake-S GT1 [UHD Graphics 770]', vram: 128 },
    {
      vendor: 'Advanced Micro Devices, Inc. [AMD/ATI]',
      model: 'Navi 31 [Radeon RX 7900 XT/7900 XTX/7900M]',
      vram: 20480,
    },
  ]);
  assert.equal(amd.model, 'Navi 31 [Radeon RX 7900 XT/7900 XTX/7900M]');

  const nvidia = d.pickGpu([
    { vendor: 'Intel Corporation', model: 'Alder Lake-P GT2 [Iris Xe Graphics]', vram: 128 },
    { vendor: 'NVIDIA Corporation', model: 'GA104 [GeForce RTX 3070]', vram: 8192 },
  ]);
  assert.equal(nvidia.model, 'GA104 [GeForce RTX 3070]');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/detectSpecs.test.js`
Expected: FAIL — the first new test reports `'Picasso/Raven 2 [Radeon Vega Series / Radeon Vega Mobile Series]' !== 'GA107M [GeForce RTX 3050 Mobile]'`: the APU outranked the dedicated card.

- [ ] **Step 3: Implement**

Replace the `integrated` computation inside `pickGpu` in `lib/detectSpecs.js`:

```js
// Windows gets a driver-supplied marketing name ("Radeon Vega 8 Graphics").
// Linux gets the PCI ID database's name, which leads with the silicon codename
// and never says "graphics" — "Picasso/Raven 2 [Radeon Vega Series]". Matching
// on the codename is the only reliable tell that a chip is an APU there.
const AMD_APU_CODENAMES =
  /\b(picasso|raven|renoir|cezanne|rembrandt|phoenix|strix|barcelo|lucienne|van gogh|mendocino|hawk point|krackan)\b/;

function pickGpu(controllers) {
  if (!controllers || controllers.length === 0) return { model: null, vendor: null, vramMB: null };
  const scored = controllers.map((c) => {
    const vram = Number(c.vram) || 0; // MB
    const vendor = (c.vendor || '').toLowerCase();
    const model = (c.model || '').toLowerCase();
    const integrated =
      /intel/.test(vendor) ||
      /uhd|hd graphics|iris|radeon graphics|integrated/.test(model) ||
      AMD_APU_CODENAMES.test(model) ||
      // "Radeon Vega Series"/"Radeon Vega 8" are APUs; "RX Vega 56" is not.
      (/\bvega\b/.test(model) && !/\brx vega/.test(model)) ||
      // Mobile APU iGPUs ship as "Radeon 680M"/"880M" — the M suffix on a bare
      // three-digit number is the tell; dedicated mobile parts say "RX".
      (/\bradeon \d{3}m\b/.test(model) && !/\brx\b/.test(model));
    // dedicated + more VRAM ranks higher
    const rank = (integrated ? 0 : 1000000) + vram;
    return { c, vram, rank };
  });
  scored.sort((a, b) => b.rank - a.rank);
  const best = scored[0].c;
  return {
    model: best.model || null,
    vendor: best.vendor || null,
    vramMB: Number(best.vram) || null,
  };
}
```

- [ ] **Step 4: Run the test**

Run: `node --test test/detectSpecs.test.js`
Expected: PASS — 18 tests, including the three pre-existing `pickGpu` cases (`UHD Graphics 630`, `Radeon Vega 8 Graphics`, `Radeon RX Vega 56`) unchanged.

- [ ] **Step 5: Commit**

```bash
git add lib/detectSpecs.js test/detectSpecs.test.js && git commit -m "fix(linux): stop ranking AMD APUs as dedicated GPUs"
```

---

### Task 16: Refuse to report VRAM that cannot be trusted

**Files:**
- Modify: `lib/detectSpecs.js`
- Test: `test/detectSpecs.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/detectSpecs.test.js`:

```js
test('linuxVramMB prefers the amdgpu sysfs figure over the PCI BAR guess', () => {
  const readSysfs = () => 8589934592; // 8 GiB in bytes
  assert.equal(d.linuxVramMB({ vram: 256, model: 'Navi 22 [Radeon RX 6700 XT]' }, readSysfs), 8192);
});

test('linuxVramMB rejects a small BAR window reported for a dedicated card', () => {
  // lspci sees only the 256 MB legacy BAR on a pre-Resizable-BAR board. Passing
  // that number on would cap an 8 GB card at 0.25 GB in the VRAM gate.
  assert.equal(d.linuxVramMB({ vram: 256, model: 'GA104 [GeForce RTX 3070]' }, () => null), null);
  assert.equal(d.linuxVramMB({ vram: 512, model: 'Navi 31 [Radeon RX 7900 XTX]' }, () => null), null);
});

test('linuxVramMB trusts a plausible figure as reported', () => {
  assert.equal(d.linuxVramMB({ vram: 8192, model: 'GA104 [GeForce RTX 3070]' }, () => null), 8192);
  assert.equal(d.linuxVramMB({ vram: 1024, model: 'GK208B [GeForce GT 710]' }, () => null), 1024);
});

test('linuxVramMB leaves a small figure alone when the chip really is integrated', () => {
  assert.equal(
    d.linuxVramMB({ vram: 512, model: 'Picasso/Raven 2 [Radeon Vega Series]' }, () => null),
    512
  );
  assert.equal(d.linuxVramMB({ vram: 128, model: 'Alder Lake-P GT2 [Iris Xe Graphics]' }, () => null), 128);
});

test('linuxVramMB tolerates a controller with no vram at all', () => {
  assert.equal(d.linuxVramMB({ vram: 0, model: 'GA104 [GeForce RTX 3070]' }, () => null), null);
  assert.equal(d.linuxVramMB({}, () => null), null);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/detectSpecs.test.js`
Expected: FAIL — `d.linuxVramMB is not a function`

- [ ] **Step 3: Implement**

Add to `lib/detectSpecs.js`, after `pickGpu`:

```js
// The largest PCI BAR window a card exposes is not its VRAM. systeminformation
// falls back to that number for everything except NVIDIA's proprietary driver
// (which it reads from nvidia-smi), and on a board without Resizable BAR the
// window is a legacy 256 MB regardless of how much memory the card has.
// Reporting that would cap an 8 GB card at 0.25 GB in compare.js's VRAM gate.
// A null gets the gate skipped entirely (compare.js: `if (!requiredGB ||
// !userGB) return base`), which is the honest answer — better a missing check
// than a confidently wrong one.
const BAR_SUSPICION_MB = 512;

function amdgpuVramBytes() {
  let cards;
  try {
    cards = fs.readdirSync('/sys/class/drm');
  } catch {
    return null;
  }
  let best = null;
  for (const card of cards) {
    if (!/^card\d+$/.test(card)) continue;
    try {
      const raw = fs.readFileSync(`/sys/class/drm/${card}/device/mem_info_vram_total`, 'utf8');
      const bytes = Number(String(raw).trim());
      if (isFinite(bytes) && bytes > 0 && (best == null || bytes > best)) best = bytes;
    } catch {
      /* not an amdgpu card, or an older kernel */
    }
  }
  return best;
}

function looksIntegrated(model) {
  const m = String(model || '').toLowerCase();
  return (
    /uhd|hd graphics|iris|radeon graphics|integrated/.test(m) ||
    AMD_APU_CODENAMES.test(m) ||
    (/\bvega\b/.test(m) && !/\brx vega/.test(m))
  );
}

function linuxVramMB(controller, readSysfs = amdgpuVramBytes) {
  const reported = Number(controller && controller.vram) || 0;
  const sysfsBytes = readSysfs();
  if (sysfsBytes) return Math.round(sysfsBytes / 1024 ** 2);
  if (!reported) return null;
  if (reported <= BAR_SUSPICION_MB && !looksIntegrated(controller.model)) return null;
  return reported;
}
```

Note this needs `fs` — `lib/detectSpecs.js` does not require it today. Add `const fs = require('fs');` to the top requires (the local name `fs` is already used as a *parameter* inside `probe()` for the `si.fsSize()` result; rename that parameter to `disks` in the destructuring and in the `pickSystemDisk(fs)` call below it to avoid shadowing):

```js
    const [cpu, graphics, mem, os, disks] = await Promise.all([
```
```js
    out.freeDiskGB = pickSystemDisk(disks);
```

Then apply the correction in `probe()`, replacing `out.gpuVramMB = g.vramMB;`:

```js
    out.gpuVramMB =
      process.platform === 'linux'
        ? linuxVramMB({ vram: g.vramMB, model: g.model })
        : g.vramMB;
```

Add `linuxVramMB` to `module.exports`.

- [ ] **Step 4: Run the test**

Run: `node --test test/detectSpecs.test.js`
Expected: PASS — 23 tests

- [ ] **Step 5: Commit**

```bash
git add lib/detectSpecs.js test/detectSpecs.test.js && git commit -m "fix(linux): report VRAM as unknown rather than as a PCI BAR window"
```

---

### Task 17: Measure free space on the disk the game's library is on

> **Why:** `pickSystemDisk` looks for `%SystemDrive%`, which no Linux mount ever matches, so today it silently takes whatever `si.fsSize()` lists first. Even picking `/` would be wrong often: Linux users routinely park games on a separate partition, and a "70 GB available space" requirement is about the disk the game installs to. The Steam library index already knows which one that is.

**Files:**
- Modify: `lib/detectSpecs.js:69-77`
- Test: `test/detectSpecs.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/detectSpecs.test.js`:

```js
test('pickSystemDisk targets the mount that contains a given path', () => {
  const list = [
    { mount: '/', available: 40 * 1024 ** 3 },
    { mount: '/home', available: 200 * 1024 ** 3 },
    { mount: '/mnt/games', available: 900 * 1024 ** 3 },
  ];
  const gb = d.pickSystemDisk(list, '/mnt/games/SteamLibrary');
  assert.ok(Math.abs(gb - 900) < 1, `expected ~900 GB, got ${gb}`);
});

test('pickSystemDisk picks the longest matching mount, not the first', () => {
  const list = [
    { mount: '/', available: 40 * 1024 ** 3 },
    { mount: '/home', available: 200 * 1024 ** 3 },
  ];
  const gb = d.pickSystemDisk(list, '/home/user/.local/share/Steam');
  assert.ok(Math.abs(gb - 200) < 1, `expected ~200 GB, got ${gb}`);
});

test('pickSystemDisk falls back to the root mount when the target matches nothing', () => {
  const list = [
    { mount: '/boot/efi', available: 1 * 1024 ** 3 },
    { mount: '/', available: 40 * 1024 ** 3 },
  ];
  const gb = d.pickSystemDisk(list, '/nowhere/at/all');
  assert.ok(Math.abs(gb - 40) < 1, `expected ~40 GB from /, got ${gb}`);
});

test('pickSystemDisk without a target behaves exactly as before', () => {
  const list = [
    { mount: 'D:', available: 900 * 1024 ** 3 },
    { mount: 'C:', available: 120 * 1024 ** 3 },
  ];
  const gb = d.pickSystemDisk(list);
  assert.ok(Math.abs(gb - 120) < 1, `expected ~120 GB, got ${gb}`);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/detectSpecs.test.js`
Expected: FAIL — the first new test gets ~40 GB (the first list entry) instead of ~900.

- [ ] **Step 3: Implement**

Replace `pickSystemDisk` in `lib/detectSpecs.js`:

```js
// Free space on the disk that matters. With a targetPath (the Steam library the
// game installs into) this is a longest-prefix match against the mount table —
// on Linux a library at /mnt/games and the root filesystem are both mounts, and
// only one of them is the answer. Without a target it keeps the original
// behavior: the volume the OS lives on.
function pickSystemDisk(fsList, targetPath) {
  if (!Array.isArray(fsList) || fsList.length === 0) return null;

  let match = null;
  if (targetPath) {
    const target = String(targetPath).replace(/\\/g, '/');
    let bestLen = -1;
    for (const f of fsList) {
      const mount = String(f.mount || '').replace(/\\/g, '/');
      if (!mount) continue;
      const prefix = mount.endsWith('/') ? mount : `${mount}/`;
      const hit = target === mount || `${target}/`.startsWith(prefix);
      if (hit && mount.length > bestLen) {
        bestLen = mount.length;
        match = f;
      }
    }
    if (!match) match = fsList.find((f) => f.mount === '/') || null;
  }

  if (!match) {
    const sysLetter = (process.env.SystemDrive || 'C:').toUpperCase();
    match =
      fsList.find((f) => String(f.mount || '').toUpperCase().startsWith(sysLetter)) || fsList[0];
  }
  if (!match) return null;

  const free = Number(match.available != null ? match.available : match.size - match.used);
  return isFinite(free) && free > 0 ? free / 1024 ** 3 : null;
}
```

- [ ] **Step 4: Run the test**

Run: `node --test test/detectSpecs.test.js`
Expected: PASS — 27 tests, with `pickSystemDisk picks the volume Windows lives on` and the two other original cases untouched.

- [ ] **Step 5: Commit**

```bash
git add lib/detectSpecs.js test/detectSpecs.test.js && git commit -m "feat: measure free space on the disk a given path lives on"
```

---

### Task 18: Point the disk check at the game's own Steam library

**Files:**
- Modify: `lib/detectSpecs.js` (`refreshDiskSpace`)
- Modify: `main.js:151-186` (`handleGame`)
- Test: `test/detectSpecs.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/detectSpecs.test.js`:

```js
test('refreshDiskFor accepts a target path and updates the cached free space', async () => {
  d._reset();
  const specs = await d.detectSpecs();
  const before = specs.freeDiskGB;
  const after = await d.refreshDiskFor(null); // no target — same disk as before
  assert.ok(
    after === null || typeof after === 'number',
    `refreshDiskFor must resolve to a number or null, got ${typeof after}`
  );
  if (before != null && after != null) {
    assert.ok(Math.abs(before - after) < 5, 'the same disk should not move by 5 GB mid-test');
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/detectSpecs.test.js`
Expected: FAIL — `d.refreshDiskFor is not a function`

- [ ] **Step 3: Implement**

In `lib/detectSpecs.js`, replace `refreshDiskSpace` with a targetable version and keep the old name as the no-target caller:

```js
// Free space is the one volatile field in the cached spec sheet, so it is
// refreshed without blocking. Once a game is known, the refresh is re-aimed at
// the library that game installs into rather than at the OS volume.
async function refreshDiskFor(targetPath) {
  try {
    const disks = await si.fsSize();
    const free = pickSystemDisk(disks, targetPath);
    if (free != null && cached) {
      cached.freeDiskGB = free;
      cache.set(NS, KEY, cached, { limit: 4 });
    }
    return free;
  } catch {
    return null; // stale value is fine
  }
}

function refreshDiskSpace() {
  refreshDiskFor(null);
}
```

Add `refreshDiskFor` to `module.exports`.

In `main.js`, add the require next to the others:

```js
const steamLibrary = require('./lib/steamLibrary');
```

Then inside `handleGame`, in the `try` block right after the specs guard, re-aim the disk check:

```js
    // before
    if (!state.specs) state.specs = await detectSpecs();
    if (currentAppid !== appid) return;

    // after
    if (!state.specs) state.specs = await detectSpecs();
    if (currentAppid !== appid) return;

    // A "70 GB available" line is about the disk the game installs to, which on
    // a multi-library setup is not the one the OS lives on. Fire and forget —
    // the sheet is already usable with the previous figure.
    if (state.steamPath) {
      steamLibrary
        .libraryForAppid(state.steamPath, appid)
        .then((root) => (root ? require('./lib/detectSpecs').refreshDiskFor(root) : null))
        .then((free) => {
          if (free != null && currentAppid === appid && state.specs) {
            state.specs.freeDiskGB = free;
            pushState();
          }
        })
        .catch((e) => log.debug('library disk refresh failed', e));
    }
```

Simplify that inline `require` by widening the existing import at the top of `main.js`:

```js
// before
const { detectSpecs } = require('./lib/detectSpecs');

// after
const { detectSpecs, refreshDiskFor } = require('./lib/detectSpecs');
```

and using `refreshDiskFor(root)` directly in the chain above.

- [ ] **Step 4: Run the test**

Run: `node --test`
Expected: PASS — full suite green, 28 tests in `test/detectSpecs.test.js`.

- [ ] **Step 5: Commit**

```bash
git add lib/detectSpecs.js main.js test/detectSpecs.test.js && git commit -m "feat: measure free space on the library the current game installs to"
```

---

### Task 19: Replace the OS and DirectX chips on Linux

**Files:**
- Modify: `lib/extras.js`
- Test: `test/extras.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/extras.test.js`:

```js
test('vulkanForDirectX maps a DirectX level onto the Vulkan version Proton needs', () => {
  assert.equal(e.vulkanForDirectX(12), 1.3);
  assert.equal(e.vulkanForDirectX(11), 1.1);
  assert.equal(e.vulkanForDirectX(10), 1.1);
  assert.equal(e.vulkanForDirectX(9), 1.1);
  assert.equal(e.vulkanForDirectX(null), null);
});

test('buildExtras frames the OS row through Proton on Linux', () => {
  const specs = {
    platform: 'linux',
    windowsVersion: null,
    directX: null,
    vulkanVersion: 1.3,
    distroDisplay: 'Ubuntu 24.04',
    arch: 'x64',
    freeDiskGB: 200,
  };
  const chips = e.buildExtras({ os: '64-bit Windows 10', directx: 'Version 12' }, specs);
  const os = chips.find((c) => c.key === 'os');
  assert.ok(os, 'the SO chip must still be emitted');
  assert.equal(os.required, 'Windows 10 · via Proton');
  assert.equal(os.user, 'Ubuntu 24.04');
  assert.equal(os.ok, null, 'Proton compatibility is never a pass/fail we can compute here');
  assert.equal(os.soft, true);
});

test('buildExtras swaps DirectX for Vulkan on Linux', () => {
  const specs = { platform: 'linux', vulkanVersion: 1.3, arch: 'x64' };
  const chips = e.buildExtras({ directx: 'Version 12' }, specs);
  assert.equal(chips.find((c) => c.key === 'directx'), undefined, 'no DirectX chip on Linux');
  const vk = chips.find((c) => c.key === 'vulkan');
  assert.equal(vk.label, 'Vulkan');
  assert.equal(vk.required, '1.3');
  assert.equal(vk.user, '1.3');
  assert.equal(vk.ok, true);
  assert.equal(vk.soft, true);
});

test('the Vulkan chip fails honestly when the driver is too old', () => {
  const chips = e.buildExtras({ directx: 'Version 12' }, { platform: 'linux', vulkanVersion: 1.1 });
  assert.equal(chips.find((c) => c.key === 'vulkan').ok, false);
});

test('the Vulkan chip is unknown when no driver declared a version', () => {
  const chips = e.buildExtras({ directx: 'Version 12' }, { platform: 'linux', vulkanVersion: null });
  const vk = chips.find((c) => c.key === 'vulkan');
  assert.equal(vk.ok, null);
  assert.equal(vk.user, null);
});

test('the Windows rows are untouched when the platform is win32 or unset', () => {
  const win = { windowsVersion: 11, directX: 12, arch: 'x64', freeDiskGB: 200 };
  for (const specs of [win, { ...win, platform: 'win32' }]) {
    const chips = e.buildExtras({ os: '64-bit Windows 10', directx: 'Version 12' }, specs);
    assert.equal(chips.find((c) => c.key === 'os').required, 'Windows 10');
    assert.equal(chips.find((c) => c.key === 'os').ok, true);
    assert.equal(chips.find((c) => c.key === 'directx').ok, true);
    assert.equal(chips.find((c) => c.key === 'vulkan'), undefined);
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/extras.test.js`
Expected: FAIL — `e.vulkanForDirectX is not a function`

- [ ] **Step 3: Implement**

In `lib/extras.js`, add after `fmtWin`:

```js
// What a DirectX requirement really asks for on Linux. DXVK translates D3D9-11
// on top of Vulkan 1.1; VKD3D-Proton wants 1.3 for a complete D3D12 feature
// set. Guidance, not a gate — the same `soft` treatment the DirectX row has
// always had, for the same reason: the driver's declared level is not the whole
// story about what a card can do.
function vulkanForDirectX(dx) {
  if (dx == null) return null;
  return dx >= 12 ? 1.3 : 1.1;
}
```

Replace the `os` and `directx` blocks inside `buildExtras`:

```js
  const linux = specs.platform === 'linux';

  const reqWin = parseWindowsVersion(reqBlock.os);
  if (reqWin != null) {
    if (linux) {
      // Comparing a Windows version against a machine that will never run
      // Windows is noise. What the user needs to know is that the requirement
      // is being satisfied through a translation layer, and what they're on.
      out.push({
        key: 'os',
        label: 'SO',
        required: `${fmtWin(reqWin)} · via Proton`,
        user: specs.distroDisplay || null,
        ok: null,
        soft: true,
      });
    } else {
      const user = specs.windowsVersion;
      out.push({
        key: 'os',
        label: 'SO',
        required: fmtWin(reqWin),
        user: fmtWin(user),
        ok: user == null ? null : user >= reqWin,
      });
    }
  }

  const reqDx = parseDirectX(reqBlock.directx);
  if (reqDx != null) {
    if (linux) {
      const reqVk = vulkanForDirectX(reqDx);
      const user = specs.vulkanVersion;
      out.push({
        key: 'vulkan',
        label: 'Vulkan',
        required: `${reqVk}`,
        user: user == null ? null : `${user}`,
        ok: user == null ? null : user >= reqVk,
        soft: true, // the driver's declared level, not a negotiated one
      });
    } else {
      const user = specs.directX;
      out.push({
        key: 'directx',
        label: 'DirectX',
        required: `${reqDx}`,
        user: user == null ? null : `${user}`,
        ok: user == null ? null : user >= reqDx,
        soft: true, // OS-level guidance; the GPU's feature level is the real gate
      });
    }
  }
```

Add `vulkanForDirectX` to `module.exports`.

No renderer change is needed: `renderExtras` (`renderer.js:437-456`) builds every chip from `item.label` / `item.required` / `item.ok` / `item.soft` generically and never switches on `item.key`, so a new key renders correctly the moment it is emitted.

- [ ] **Step 4: Run the test**

Run: `node --test test/extras.test.js`
Expected: PASS — 14 tests, including every pre-existing Windows assertion unchanged.

- [ ] **Step 5: Commit**

```bash
git add lib/extras.js test/extras.test.js && git commit -m "feat(linux): frame the OS chip through Proton and swap DirectX for Vulkan"
```

---

### Task 20: Show the Linux machine in the rig sheet

**Files:**
- Modify: `renderer.js:514-518`

- [ ] **Step 1: Apply the change**

The `SO` row currently prints nothing but `arch` on Linux, because both guards are on Windows-only fields.

```js
  // before
  const os = [];
  if (s.windowsVersion) os.push(`Windows ${s.windowsVersion}`);
  if (s.directX) os.push(`DirectX ${s.directX}`);
  if (s.arch) os.push(s.arch);
  if (os.length) rows.push(['SO', os.join(' · '), '']);

  // after
  const os = [];
  if (s.platform === 'linux') {
    if (s.distroDisplay) os.push(s.distroDisplay);
    if (s.kernel) os.push(`kernel ${s.kernel}`);
    if (s.vulkanVersion) os.push(`Vulkan ${s.vulkanVersion}`);
  } else {
    if (s.windowsVersion) os.push(`Windows ${s.windowsVersion}`);
    if (s.directX) os.push(`DirectX ${s.directX}`);
  }
  if (s.arch) os.push(s.arch);
  if (os.length) rows.push(['SO', os.join(' · '), '']);
```

- [ ] **Step 2: Also tell the user when the GPU could not be identified at all**

`si.graphics()` shells out to `lspci`; if `pciutils` is not installed the controller list comes back empty and the GPU row simply vanishes with no explanation. Add a fallback row immediately after the GPU block in `rigRows`:

```js
  // before
  if (s.gpuDisplay || s.gpu) {
    rows.push(['GPU', s.gpuDisplay || s.gpu, s.gpuVramMB ? `${Math.round(s.gpuVramMB / 1024)} GB VRAM` : '']);
  }

  // after
  if (s.gpuDisplay || s.gpu) {
    rows.push(['GPU', s.gpuDisplay || s.gpu, s.gpuVramMB ? `${Math.round(s.gpuVramMB / 1024)} GB VRAM` : '']);
  } else if (s.platform === 'linux') {
    rows.push(['GPU', 'não detectada', 'instale o pacote pciutils']);
  }
```

- [ ] **Step 3: Verify**

Run: `node --test`
Expected: PASS — full suite green (the renderer has no unit tests; this is a regression guard).

Then confirm both edits landed:

Run: `node -e "const s=require('fs').readFileSync('renderer.js','utf8'); console.log(s.includes(\"kernel ${'$'}{s.kernel}\".replace(/[$]/g,'')) || s.includes('kernel '), s.includes('pciutils'))"`
Expected: `true true`

- [ ] **Step 4: Commit**

```bash
git add renderer.js && git commit -m "feat(linux): show distro, kernel and Vulkan in the rig sheet"
```

---

### Phase 3 verification

- [ ] **Step 1: Full gate**

Run: `npm run verify`
Expected: `validate-tables.js` with no `MISSING` lines, `selfcheck.js` exiting 0, then `node --test` with `fail 0`.

- [ ] **Step 2: Hand-check on Linux**

- [ ] `SO` row reads e.g. `Ubuntu 24.04 · kernel 6.8.0-45-generic · Vulkan 1.3 · x64`.
- [ ] On an AMD APU laptop with a discrete card, the GPU row names the **discrete** card, not the APU.
- [ ] On a discrete card, the VRAM figure matches `nvidia-smi --query-gpu=memory.total --format=csv` (NVIDIA) or `cat /sys/class/drm/card*/device/mem_info_vram_total` divided by 1048576 (AMD) — or is absent entirely rather than showing a 256 MB figure.
- [ ] With a game installed on a second library on another partition, the `DISCO` row matches `df -h` for that partition, not for `/`.
- [ ] Temporarily rename `lspci` out of `$PATH` and relaunch: the GPU row reads `não detectada · instale o pacote pciutils` instead of disappearing.

---

## Phase 4: Requirements and Proton

**Goal:** Stop showing a Linux user a Windows requirements panel with no explanation. Prefer a game's native Linux requirements when they exist (~7.6% of the catalogue), fall back to the Windows block explicitly framed as running through Proton (the normal case — roughly 90% of Windows titles are Proton-playable), and add the one signal a spec comparison genuinely cannot provide on its own: whether the game actually runs.

**Exit criteria:**
- [ ] `fromAppDetails` reports `linux`, `nativeLinux`, `minimumLinux`, `recommendedLinux`.
- [ ] `steamApi.pickRequirements(info, platform)` chooses the block and reports `reqOs` and `viaProton`.
- [ ] `main.js` compares against the chosen block, and no Windows block ever reaches a Linux user unlabelled.
- [ ] A ProtonDB tier and the resolved Proton build appear in state, fetched only on Linux, cached, and never blocking the UI.

---

### Task 21: Parse the Linux requirements block from the API

> **Why:** Steam returns `linux_requirements` in three shapes — a real object, an object whose values are an empty `<ul>`, and a bare `[]`. All three already collapse to `null` through the existing `reqField()` (which guards `Array.isArray`) and `parseRequirementsFragment()` (which treats an empty list as nothing). Reusing them verbatim means no new parsing code and no new failure modes.

**Files:**
- Modify: `lib/steamApi.js:66-82`
- Test: `test/steamApi.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/steamApi.test.js`:

```js
test('fromAppDetails reads a native Linux requirements block', () => {
  const info = api.fromAppDetails(
    {
      name: 'Factorio',
      platforms: { windows: true, mac: true, linux: true },
      pc_requirements: {
        minimum: '<strong>Minimum:</strong><br><ul class="bb_ul"><li><strong>OS:</strong> Windows 10<br></li></ul>',
      },
      linux_requirements: {
        minimum:
          '<strong>Minimum:</strong><br><ul class="bb_ul"><li><strong>OS:</strong> Ubuntu 20.04<br></li><li><strong>Memory:</strong> 4 GB RAM<br></li></ul>',
      },
    },
    427520
  );
  assert.equal(info.linux, true);
  assert.equal(info.nativeLinux, true);
  assert.ok(info.minimumLinux, 'the Linux minimum block must be parsed');
  assert.equal(info.recommendedLinux, null);
  assert.ok(info.minimum, 'the Windows block must still be parsed alongside it');
});

test('fromAppDetails treats an empty <ul> Linux block as no Linux requirements', () => {
  const info = api.fromAppDetails(
    {
      name: 'Elden Ring',
      platforms: { windows: true, mac: false, linux: false },
      pc_requirements: {
        minimum: '<strong>Minimum:</strong><br><ul class="bb_ul"><li><strong>OS:</strong> Windows 10<br></li></ul>',
      },
      linux_requirements: {
        minimum: '<strong>Minimum:</strong><br><ul class="bb_ul"></ul>',
        recommended: '<strong>Recommended:</strong><br><ul class="bb_ul"></ul>',
      },
    },
    1245620
  );
  assert.equal(info.linux, false);
  assert.equal(info.nativeLinux, false);
  assert.equal(info.minimumLinux, null);
});

test('fromAppDetails treats a bare-array Linux block as no Linux requirements', () => {
  const info = api.fromAppDetails(
    {
      name: 'SteamVR',
      platforms: { windows: true, mac: false, linux: true },
      pc_requirements: { minimum: '<ul class="bb_ul"><li><strong>OS:</strong> Windows 10</li></ul>' },
      linux_requirements: [],
    },
    250820
  );
  assert.equal(info.linux, true, 'platforms.linux is the catalogue flag, independent of the block');
  assert.equal(info.nativeLinux, false);
  assert.equal(info.minimumLinux, null);
});

test('fromAppDetails defaults linux to true when platforms is absent', () => {
  const info = api.fromAppDetails({ name: 'Whatever' }, 1);
  assert.equal(info.linux, true);
  assert.equal(info.nativeLinux, false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/steamApi.test.js`
Expected: FAIL — `expected undefined to equal true` on `info.nativeLinux`.

- [ ] **Step 3: Implement**

Replace `fromAppDetails` in `lib/steamApi.js`:

```js
function fromAppDetails(data, appid) {
  const pc = data.pc_requirements;
  const minimum = scraper.parseRequirementsFragment(reqField(pc, 'minimum'));
  const recommended = scraper.parseRequirementsFragment(reqField(pc, 'recommended'));

  // Steam encodes "no requirements for this platform" three ways: a missing
  // key, a bare [], and an object holding an empty <ul>. reqField() already
  // handles the array and parseRequirementsFragment() already collapses an
  // empty list, so all three land on null with no extra branch here.
  const lin = data.linux_requirements;
  const minimumLinux = scraper.parseRequirementsFragment(reqField(lin, 'minimum'));
  const recommendedLinux = scraper.parseRequirementsFragment(reqField(lin, 'recommended'));

  const windows = !data.platforms || data.platforms.windows !== false;
  const linux = !data.platforms || data.platforms.linux !== false;
  return {
    appid: String(appid),
    name: data.name || null,
    type: data.type || null,
    headerImage: data.header_image || null,
    windows,
    linux,
    nativeLinux: !!(minimumLinux || recommendedLinux),
    available: !!(minimum || recommended),
    minimum,
    recommended,
    minimumLinux,
    recommendedLinux,
    source: 'api',
  };
}
```

- [ ] **Step 4: Run the test**

Run: `node --test test/steamApi.test.js`
Expected: PASS — 4 new tests plus every existing one.

- [ ] **Step 5: Commit**

```bash
git add lib/steamApi.js test/steamApi.test.js && git commit -m "feat(linux): parse the native Linux requirements block from appdetails"
```

---

### Task 22: Extract the Linux block from a scraped store page

**Files:**
- Modify: `lib/steamScraper.js`
- Test: `test/scraper.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/scraper.test.js`:

```js
const LINUX_PAGE = `
<div class="game_page_background">
  <div class="game_area_sys_req sysreq_content" data-os="win">
    <ul class="bb_ul"><li><strong>OS:</strong> Windows 10</li><li><strong>Memory:</strong> 8 GB RAM</li></ul>
  </div>
  <div class="game_area_sys_req sysreq_content" data-os="linux">
    <ul class="bb_ul"><li><strong>OS:</strong> Ubuntu 20.04</li><li><strong>Memory:</strong> 4 GB RAM</li></ul>
  </div>
</div>`;

test('scrapeLinuxBlock reads the data-os="linux" section', () => {
  const out = s.scrapeLinuxBlock(LINUX_PAGE);
  assert.equal(out.available, true);
  assert.ok(out.minimum, 'a Linux minimum block must come back');
  assert.equal(out.minimum.ram, '4 GB RAM');
});

test('scrapeLinuxBlock returns nothing when the page has no Linux section', () => {
  const out = s.scrapeLinuxBlock(`
<div class="game_area_sys_req sysreq_content" data-os="win">
  <ul class="bb_ul"><li><strong>OS:</strong> Windows 10</li></ul>
</div>`);
  assert.equal(out.available, false);
  assert.equal(out.minimum, null);
});

test('scrapeLinuxBlock never falls back to an unlabelled or mac block', () => {
  const out = s.scrapeLinuxBlock(`
<div class="game_area_sys_req sysreq_content">
  <ul class="bb_ul"><li><strong>OS:</strong> Windows 10</li></ul>
</div>
<div class="game_area_sys_req sysreq_content" data-os="mac">
  <ul class="bb_ul"><li><strong>OS:</strong> macOS 12</li></ul>
</div>`);
  assert.equal(out.available, false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/scraper.test.js`
Expected: FAIL — `s.scrapeLinuxBlock is not a function`

- [ ] **Step 3: Implement**

Add to `lib/steamScraper.js`, next to the existing Windows extractor (reusing whatever the file already names its `<ul>`-to-block helpers — do not duplicate them):

```js
// Sibling of the Windows extractor. Kept strictly separate: the Windows path
// deliberately falls back to an unlabelled block, because a Windows-only game
// often has exactly one requirements section with no data-os attribute at all.
// A Linux section is never unlabelled, so this one has no fallback — an absent
// data-os="linux" block means the game has no published Linux requirements,
// not that the unlabelled block might be one.
function scrapeLinuxBlock(html) {
  const $ = cheerio.load(html);
  const $lin = $('.game_area_sys_req[data-os="linux"]');
  if ($lin.length === 0) return { available: false, minimum: null, recommended: null };
  const parsed = blocksFrom($, $lin.first());
  return {
    available: !!(parsed.minimum || parsed.recommended),
    minimum: parsed.minimum,
    recommended: parsed.recommended,
  };
}
```

Read `lib/steamScraper.js` before writing this: the existing Windows path already splits a `.game_area_sys_req` element into `{minimum, recommended}`. Name the shared helper `blocksFrom($, $el)` and extract it from the existing code path so both extractors call the same function — the Windows behavior must not change, which the untouched `test/scraper.test.js:6-40` cases will prove.

Add `scrapeLinuxBlock` to `module.exports`.

- [ ] **Step 4: Run the test**

Run: `node --test test/scraper.test.js`
Expected: PASS — 3 new tests plus the 3 original ones (mac-only page → unavailable, win+mac → picks win) unchanged.

- [ ] **Step 5: Commit**

```bash
git add lib/steamScraper.js test/scraper.test.js && git commit -m "feat(linux): extract the Linux requirements block from a scraped store page"
```

---

### Task 23: Choose which requirements block to compare against

**Files:**
- Modify: `lib/steamApi.js`
- Test: `test/steamApi.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/steamApi.test.js`:

```js
const NATIVE = {
  minimum: { os: 'Windows 10', ram: '8 GB RAM' },
  recommended: null,
  minimumLinux: { os: 'Ubuntu 20.04', ram: '4 GB RAM' },
  recommendedLinux: null,
  nativeLinux: true,
};
const PROTON_ONLY = {
  minimum: { os: 'Windows 10', ram: '12 GB RAM' },
  recommended: { os: 'Windows 11', ram: '16 GB RAM' },
  minimumLinux: null,
  recommendedLinux: null,
  nativeLinux: false,
};

test('pickRequirements takes the native Linux block when there is one', () => {
  const picked = api.pickRequirements(NATIVE, 'linux');
  assert.equal(picked.reqOs, 'linux');
  assert.equal(picked.viaProton, false);
  assert.equal(picked.minimum.ram, '4 GB RAM');
});

test('pickRequirements falls back to Windows through Proton', () => {
  const picked = api.pickRequirements(PROTON_ONLY, 'linux');
  assert.equal(picked.reqOs, 'windows');
  assert.equal(picked.viaProton, true);
  assert.equal(picked.minimum.ram, '12 GB RAM');
  assert.equal(picked.recommended.ram, '16 GB RAM');
});

test('pickRequirements always takes the Windows block on Windows', () => {
  for (const info of [NATIVE, PROTON_ONLY]) {
    const picked = api.pickRequirements(info, 'win32');
    assert.equal(picked.reqOs, 'windows');
    assert.equal(picked.viaProton, false);
    assert.equal(picked.minimum.os, 'Windows 10');
  }
});

test('pickRequirements tolerates a missing info object', () => {
  const picked = api.pickRequirements(null, 'linux');
  assert.equal(picked.minimum, null);
  assert.equal(picked.recommended, null);
  assert.equal(picked.reqOs, 'windows');
  assert.equal(picked.viaProton, false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/steamApi.test.js`
Expected: FAIL — `api.pickRequirements is not a function`

- [ ] **Step 3: Implement**

Add to `lib/steamApi.js`, above `module.exports`:

```js
// Which requirements block a given machine should actually be compared against.
// Native Linux builds exist for roughly 8% of the catalogue; for the rest, the
// Windows block is still the right answer — it is what Proton will be asked to
// run — but it must never be shown on Linux without saying so, or it reads as
// the app comparing against the wrong platform.
function pickRequirements(info, platform) {
  const src = info || {};
  if (platform === 'linux' && src.nativeLinux) {
    return {
      minimum: src.minimumLinux || null,
      recommended: src.recommendedLinux || null,
      reqOs: 'linux',
      viaProton: false,
    };
  }
  return {
    minimum: src.minimum || null,
    recommended: src.recommended || null,
    reqOs: 'windows',
    viaProton: platform === 'linux',
  };
}
```

Add `pickRequirements` to `module.exports`.

- [ ] **Step 4: Run the test**

Run: `node --test test/steamApi.test.js`
Expected: PASS — 4 new tests plus everything before.

- [ ] **Step 5: Commit**

```bash
git add lib/steamApi.js test/steamApi.test.js && git commit -m "feat(linux): choose native Linux requirements over the Windows block when available"
```

---

### Task 24: Compare against the chosen block in main.js

**Files:**
- Modify: `main.js:49-69` (state), `main.js:98-105` (`buildComparison`), `main.js:151-186` (`handleGame`)

- [ ] **Step 1: Add the two new state fields**

In `main.js`, inside `state`, after the `requirements` line:

```js
  requirements: null, // { available, minimum, recommended }
  reqOs: null, // 'windows' | 'linux' — which block the comparison used
  viaProton: false, // the Windows block is being shown to a Linux machine
```

- [ ] **Step 2: Make `buildComparison` take an explicit block**

```js
  // before
  function buildComparison(info, specs) {
    const comparison = compareLib.compare(specs, info, tables);
    const extras = {
      minimum: info.minimum ? extrasLib.buildExtras(info.minimum, specs) : [],
      recommended: info.recommended ? extrasLib.buildExtras(info.recommended, specs) : [],
    };
    return { comparison, extras };
  }

  // after
  function buildComparison(block, specs) {
    const comparison = compareLib.compare(specs, block, tables);
    const extras = {
      minimum: block.minimum ? extrasLib.buildExtras(block.minimum, specs) : [],
      recommended: block.recommended ? extrasLib.buildExtras(block.recommended, specs) : [],
    };
    return { comparison, extras };
  }
```

- [ ] **Step 3: Pick the block in `handleGame`**

Replace the `if (info.available)` branch:

```js
    // before
    if (info.available) {
      const built = buildComparison(info, state.specs);
      state.comparison = built.comparison;
      state.extras = built.extras;
      state.requirementsError = null;
    } else {

    // after
    const picked = steamApi.pickRequirements(info, state.specs.platform);
    state.reqOs = picked.reqOs;
    state.viaProton = picked.viaProton;
    const hasBlock = !!(picked.minimum || picked.recommended);

    if (hasBlock) {
      const built = buildComparison(picked, state.specs);
      state.comparison = built.comparison;
      state.extras = built.extras;
      state.requirementsError = null;
    } else {
```

And clear both fields in `clearGameState`, next to `state.requirements = null;`:

```js
  state.reqOs = null;
  state.viaProton = false;
```

- [ ] **Step 4: Verify**

Run: `node --test`
Expected: PASS — full suite green.

Run: `npm run selfcheck`
Expected: exit 0 — the selfcheck drives the same parse→compare→extras pipeline with a Windows-shaped fixture and would break loudly if `buildComparison`'s new signature were wired wrong.

- [ ] **Step 5: Commit**

```bash
git add main.js && git commit -m "feat(linux): compare against the requirements block that matches the host platform"
```

---

### Task 25: Fetch the ProtonDB compatibility tier

> **Why:** The ProtonDB endpoint sends no CORS header, so a renderer `fetch()` would be blocked outright — and every other network call in this app already lives in the main process for exactly that reason. It is also a community project with no published rate limit or terms, so it gets a long cache, a short timeout, and a silent failure path.

**Files:**
- Create: `lib/protondb.js`
- Test: `test/protondb.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('../lib/appPaths')._setUserDataDir(fs.mkdtempSync(path.join(os.tmpdir(), 'sso-protondb-')));
const protondb = require('../lib/protondb');

function withFetch(impl, fn) {
  const original = global.fetch;
  global.fetch = impl;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      global.fetch = original;
    });
}

const OK = {
  ok: true,
  json: async () => ({
    bestReportedTier: 'platinum',
    confidence: 'strong',
    score: 0.93,
    tier: 'platinum',
    total: 337,
    trendingTier: 'platinum',
  }),
};

test('getTier returns the normalized summary', async () => {
  protondb._reset();
  await withFetch(
    async () => OK,
    async () => {
      const t = await protondb.getTier('427520');
      assert.equal(t.tier, 'platinum');
      assert.equal(t.confidence, 'strong');
      assert.equal(t.score, 0.93);
      assert.equal(t.total, 337);
    }
  );
});

test('getTier serves the cached answer without a second request', async () => {
  protondb._reset();
  let calls = 0;
  await withFetch(
    async () => {
      calls++;
      return OK;
    },
    async () => {
      await protondb.getTier('427520');
      protondb._reset(); // drop the in-memory memo, keep the disk cache
      await protondb.getTier('427520');
      assert.equal(calls, 1, 'the disk cache should have answered the second call');
    }
  );
});

test('getTier degrades to null on a failed request', async () => {
  protondb._reset();
  await withFetch(
    async () => {
      throw new Error('offline');
    },
    async () => {
      assert.equal(await protondb.getTier('999999'), null);
    }
  );
});

test('getTier degrades to null on a non-OK response', async () => {
  protondb._reset();
  await withFetch(
    async () => ({ ok: false, status: 404, json: async () => ({}) }),
    async () => {
      assert.equal(await protondb.getTier('999998'), null);
    }
  );
});

test('getTier rejects a payload with no tier', async () => {
  protondb._reset();
  await withFetch(
    async () => ({ ok: true, json: async () => ({ total: 0 }) }),
    async () => {
      assert.equal(await protondb.getTier('999997'), null);
    }
  );
});

test('getTier refuses a missing appid without touching the network', async () => {
  protondb._reset();
  await withFetch(
    async () => {
      throw new Error('should not be called');
    },
    async () => {
      assert.equal(await protondb.getTier(null), null);
    }
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/protondb.test.js`
Expected: FAIL — `Cannot find module '../lib/protondb'`

- [ ] **Step 3: Implement**

```js
'use strict';
// Whether a Windows game actually runs on Linux — the one question a spec
// comparison cannot answer on its own. A machine can clear every requirement
// and still be unable to launch a game whose anti-cheat refuses to run under
// Proton.
//
// ProtonDB is a community project with no affiliation to Valve, no published
// rate limit and no terms of use, and the endpoint sends no CORS header — so
// this lives in the main process, caches for a week (tiers move slowly), times
// out fast, and degrades to null on absolutely anything going wrong. It is
// never allowed to delay or block the interface.

const cache = require('./cache');
const log = require('./logger').scoped('protondb');

const NS = 'protondb';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 5000;
const TIERS = new Set(['borked', 'garbage', 'bronze', 'silver', 'gold', 'platinum', 'pending']);

let memo = new Map();

async function getTier(appid) {
  if (appid == null) return null;
  const key = String(appid);
  if (memo.has(key)) return memo.get(key);

  const hit = cache.get(NS, key, TTL_MS);
  if (hit) {
    memo.set(key, hit);
    return hit;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://www.protondb.com/api/v1/reports/summaries/${encodeURIComponent(key)}.json`,
      { signal: controller.signal }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const tier = json && typeof json.tier === 'string' ? json.tier.toLowerCase() : null;
    if (!tier || !TIERS.has(tier)) return null;
    const out = {
      tier,
      confidence: typeof json.confidence === 'string' ? json.confidence : null,
      score: typeof json.score === 'number' ? json.score : null,
      total: Number(json.total) || 0,
    };
    cache.set(NS, key, out, { limit: 400 });
    memo.set(key, out);
    return out;
  } catch (e) {
    log.debug('protondb lookup failed for', key, e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function _reset() {
  memo = new Map();
}

module.exports = { getTier, _reset };
```

- [ ] **Step 4: Run the test**

Run: `node --test test/protondb.test.js`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add lib/protondb.js test/protondb.test.js && git commit -m "feat(linux): fetch the ProtonDB compatibility tier"
```

---

### Task 26: Resolve which Proton build a game is set to use

**Files:**
- Create: `lib/proton.js`
- Test: `test/proton.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const proton = require('../lib/proton');

const CONFIG = `"InstallConfigStore"
{
  "Software" { "Valve" { "Steam" {
    "CompatToolMapping"
    {
      "0"       { "name" "proton_experimental" "config" "" "Priority" "250" }
      "1245620" { "name" "proton_9"            "config" "" "Priority" "250" }
    }
  } } }
}`;

function fakeSteam(configText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sso-proton-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  if (configText != null) fs.writeFileSync(path.join(root, 'config', 'config.vdf'), configText);
  const common = path.join(root, 'steamapps', 'common');
  fs.mkdirSync(path.join(common, 'Proton 9.0'), { recursive: true });
  fs.writeFileSync(path.join(common, 'Proton 9.0', 'proton'), '#!/usr/bin/env python3');
  fs.mkdirSync(path.join(common, 'Factorio'), { recursive: true }); // not a Proton install
  return root;
}

test('compatToolFor reads a per-game override', () => {
  assert.equal(proton.compatToolFor(CONFIG, '1245620'), 'proton_9');
});

test('compatToolFor falls back to the global default at key "0"', () => {
  assert.equal(proton.compatToolFor(CONFIG, '427520'), 'proton_experimental');
});

test('compatToolFor is null when Steam is choosing automatically', () => {
  const noMapping = '"InstallConfigStore" { "Software" { "Valve" { "Steam" { } } } }';
  assert.equal(proton.compatToolFor(noMapping, '570'), null);
  assert.equal(proton.compatToolFor('', '570'), null);
});

test('installedProtons lists folders that actually hold a proton script', async () => {
  const root = fakeSteam(CONFIG);
  const found = await proton.installedProtons([root]);
  assert.deepEqual(found, ['Proton 9.0']);
});

test('resolveFor reports the configured tool and the installs it found', async () => {
  const root = fakeSteam(CONFIG);
  const out = await proton.resolveFor(root, '1245620');
  assert.equal(out.tool, 'proton_9');
  assert.deepEqual(out.installed, ['Proton 9.0']);
});

test('resolveFor reports a null tool when nothing is mapped', async () => {
  const root = fakeSteam(null); // no config.vdf at all
  const out = await proton.resolveFor(root, '570');
  assert.equal(out.tool, null);
  assert.deepEqual(out.installed, ['Proton 9.0']);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/proton.test.js`
Expected: FAIL — `Cannot find module '../lib/proton'`

- [ ] **Step 3: Implement**

```js
'use strict';
// Which compatibility tool Steam will hand a given game, read straight off disk.
// No network, no guessing.
//
// One honest limit: when a game has neither a per-appid entry nor the global
// default at key "0", Steam picks a Proton version from server-side logic that
// is not visible locally at all. That case returns null — the UI says
// "automático" rather than inventing a version number.

const fs = require('fs');
const path = require('path');
const vdf = require('./vdf');
const steamLibrary = require('./steamLibrary');

const MAPPING_PATH = [
  'InstallConfigStore',
  'Software',
  'Valve',
  'Steam',
  'CompatToolMapping',
];

function compatToolFor(configText, appid) {
  const mapping = vdf.get(vdf.parse(configText), MAPPING_PATH);
  if (!mapping || typeof mapping !== 'object') return null;
  const entry = vdf.get(mapping, [String(appid)]) || vdf.get(mapping, ['0']);
  if (!entry || typeof entry !== 'object') return null;
  const name = vdf.get(entry, ['name']);
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

// A compatibility tool is any steamapps/common folder holding a `proton`
// executable — the folder names are not a fixed list (Proton 9.0, Proton
// Experimental, Proton-GE, GE-Proton8-32, ...), so probing for the file is
// more reliable than matching names.
async function installedProtons(libraryRoots) {
  const found = [];
  for (const root of libraryRoots) {
    const common = path.join(root, 'steamapps', 'common');
    let names;
    try {
      names = await fs.promises.readdir(common);
    } catch {
      continue;
    }
    for (const name of names) {
      try {
        await fs.promises.access(path.join(common, name, 'proton'));
        if (!found.includes(name)) found.push(name);
      } catch {
        /* an ordinary game, not a compat tool */
      }
    }
  }
  return found.sort();
}

async function resolveFor(steamPath, appid) {
  let tool = null;
  try {
    const text = await fs.promises.readFile(path.join(steamPath, 'config', 'config.vdf'), 'utf8');
    tool = compatToolFor(text, appid);
  } catch {
    /* no config yet — Steam is choosing automatically */
  }
  const installed = await installedProtons(await steamLibrary.libraryPaths(steamPath));
  return { tool, installed };
}

module.exports = { compatToolFor, installedProtons, resolveFor };
```

- [ ] **Step 4: Run the test**

Run: `node --test test/proton.test.js`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add lib/proton.js test/proton.test.js && git commit -m "feat(linux): resolve the Proton build a game is configured to use"
```

---

### Task 27: Put the Proton signals into state

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Add the state field and requires**

In `main.js`, next to the other requires:

```js
const protondb = require('./lib/protondb');
const proton = require('./lib/proton');
```

In `state`, after `viaProton`:

```js
  proton: null, // { tier, confidence, score, total, tool, installed } — Linux only
```

And in `clearGameState`:

```js
  state.proton = null;
```

- [ ] **Step 2: Load it alongside the artwork**

Add next to `loadArtwork`:

```js
// Linux-only, best-effort, and never awaited by the comparison: a missing tier
// is a missing badge, not a missing answer. Runs after the requirements are on
// screen so a slow community API can never delay the thing the user came for.
async function loadProton(appid) {
  if (!state.specs || state.specs.platform !== 'linux') return;
  const [tier, local] = await Promise.all([
    protondb.getTier(appid),
    state.steamPath
      ? proton.resolveFor(state.steamPath, appid).catch(() => ({ tool: null, installed: [] }))
      : Promise.resolve({ tool: null, installed: [] }),
  ]);
  if (currentAppid !== appid) return;
  if (!tier && !local.tool && local.installed.length === 0) return;
  state.proton = { ...(tier || {}), tool: local.tool, installed: local.installed };
  pushState();
}
```

- [ ] **Step 3: Call it from `handleGame`**

Right after the existing `loadArtwork(appid, info.headerImage);` line:

```js
    loadArtwork(appid, info.headerImage);
    loadProton(appid);
```

- [ ] **Step 4: Verify**

Run: `node --test`
Expected: PASS — full suite green.

Run: `node -e "const s=require('fs').readFileSync('main.js','utf8'); console.log(s.includes('loadProton(appid)'), s.includes(\"platform !== 'linux'\"), s.includes('state.proton = null'))"`
Expected: `true true true`

- [ ] **Step 5: Commit**

```bash
git add main.js && git commit -m "feat(linux): load ProtonDB tier and local Proton build into state"
```

---

### Task 28: Show the Proton framing in the interface

**Files:**
- Modify: `renderer.js`
- Modify: `index.html`

- [ ] **Step 1: Add the chip markup**

In `index.html`, immediately after the `<div id="extras">` element, add a sibling the renderer can fill:

```html
          <div id="proton" class="chips" hidden></div>
```

- [ ] **Step 2: Render it**

In `renderer.js`, add next to `renderExtras`:

```js
const PROTON_TIERS = {
  platinum: ['PLATINA', 'roda como se fosse nativo'],
  gold: ['OURO', 'roda bem com pequenos ajustes'],
  silver: ['PRATA', 'roda com problemas menores'],
  bronze: ['BRONZE', 'roda, mas com falhas'],
  garbage: ['RUIM', 'quase não roda'],
  borked: ['NÃO RODA', 'quebrado no Proton hoje'],
  pending: ['SEM DADOS', 'poucos relatos ainda'],
};

// Only ever rendered on Linux, and only when something is actually known —
// an empty strip is worse than no strip.
function renderProton(info, viaProton) {
  const wrap = $('#proton');
  wrap.textContent = '';
  if (!info) {
    show(wrap, false);
    return;
  }
  const chips = [];
  if (info.tier && PROTON_TIERS[info.tier]) {
    const [label, hint] = PROTON_TIERS[info.tier];
    chips.push({
      cls: `chip proton-${info.tier}`,
      text: `PROTON ${label}`,
      title: `${hint}${info.total ? ` · ${info.total} relatos no ProtonDB` : ''}`,
    });
  }
  if (viaProton) {
    chips.push({
      cls: 'chip soft',
      text: info.tool ? `via ${info.tool.replace(/_/g, ' ')}` : 'via Proton (automático)',
      title: info.installed && info.installed.length
        ? `instalados: ${info.installed.join(', ')}`
        : 'nenhuma versão do Proton instalada ainda',
    });
  }
  if (chips.length === 0) {
    show(wrap, false);
    return;
  }
  chips.forEach((c, i) => {
    const el = document.createElement('span');
    el.className = c.cls;
    el.textContent = c.text;
    el.title = c.title;
    el.style.animationDelay = `${420 + i * 25}ms`;
    wrap.appendChild(el);
  });
  show(wrap, true);
}
```

Call it from the same place `renderExtras` is called, passing `state.proton` and `state.viaProton`.

The two Windows-flavoured strings in the error map (`renderer.js:697-698`) are *not* touched here — Phase 5's Task 30 owns all OS-neutral copy in one pass, and splitting it across two phases would guarantee a merge conflict. Note also that the `no-windows` *logic* never changes: it reads Steam's catalogue flag `platforms.windows`, which is about the game rather than the host, and stays exactly the right terminal answer on Linux.

- [ ] **Step 3: Add the styles**

In `styles.css`, next to the existing `.chip` rules:

```css
.proton-platinum { --chip-accent: #b8c6db; }
.proton-gold     { --chip-accent: #d4a017; }
.proton-silver   { --chip-accent: #9aa5b1; }
.proton-bronze   { --chip-accent: #a8703c; }
.proton-garbage,
.proton-borked   { --chip-accent: #c2453d; }
```

Match whatever custom property the existing `.chip.ok` / `.chip.bad` rules use for their accent colour — read them first and reuse the same name rather than introducing `--chip-accent` if a different one already exists.

- [ ] **Step 4: Add the attribution**

In `index.html`, in the settings panel's footer area next to the version line, add:

```html
          <p class="muted">Dados de compatibilidade via ProtonDB.</p>
```

- [ ] **Step 5: Verify**

Run: `node --test`
Expected: PASS — full suite green.

Run: `npm start`
Expected (on Windows): the app launches unchanged — `state.proton` is always null there, so the strip stays hidden and nothing shifts.

- [ ] **Step 6: Commit**

```bash
git add renderer.js index.html styles.css && git commit -m "feat(linux): show the Proton tier and the compat tool in the interface"
```

---

### Task 29: Say which platform's requirements are on screen

**Files:**
- Modify: `renderer.js:667-674`

- [ ] **Step 1: Extend the subtitle**

`#game-sub` currently reads `APPID 1245620 · em execução`. On Linux it must also say which requirements block is being compared, because a native-Linux game and a Proton-translated one produce visually identical panels today.

```js
  // before
  const srcTag =
    state.game.kind === 'running'
      ? ' · em execução'
      : state.game.source === 'fallback'
        ? ' · fallback'
        : state.game.kind === 'library'
          ? ' · biblioteca'
          : '';
  $('#game-sub').textContent = `APPID ${state.game.appid}${srcTag}`;

  // after
  const srcTag =
    state.game.kind === 'running'
      ? ' · em execução'
      : state.game.source === 'fallback'
        ? ' · fallback'
        : state.game.kind === 'library'
          ? ' · biblioteca'
          : '';
  // Only meaningful on Linux: reqOs stays 'windows' on a Windows host, where
  // saying so would be noise.
  const reqTag =
    state.specs && state.specs.platform === 'linux'
      ? state.reqOs === 'linux'
        ? ' · requisitos Linux'
        : ' · requisitos Windows'
      : '';
  $('#game-sub').textContent = `APPID ${state.game.appid}${srcTag}${reqTag}`;
```

- [ ] **Step 2: Verify**

Run: `node --test`
Expected: PASS — full suite green.

Run: `node -e "const s=require('fs').readFileSync('renderer.js','utf8'); console.log(s.includes('requisitos Linux'), s.includes('requisitos Windows'))"`
Expected: `true true`

- [ ] **Step 3: Hand-check on Windows**

Run: `npm start`
Expected: the subtitle is unchanged — `state.specs.platform` is `win32`, so `reqTag` is the empty string and nothing is appended.

- [ ] **Step 4: Commit**

```bash
git add renderer.js && git commit -m "feat(linux): say which platform's requirements the panel is showing"
```

---

#### Deferred

Left out on purpose, each with the reason:

- **Steam Deck compatibility category** (`store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport`, works anonymously today, returns `resolved_category` 1=Unsupported / 2=Playable / 3=Verified). It measures the same underlying thing as the ProtonDB tier, from a completely undocumented internal endpoint that can change without notice, and its Deck-specific criteria — controller glyphs, text legibility at 7 inches, default touch settings — are noise for a desktop Linux user.
- **The exact bundled DXVK / VKD3D-Proton version.** It means reaching into `steamapps/common/Proton */files/lib64/wine/dxvk/*.dll` and pulling an embedded string, along paths that move between Proton releases. The Proton version number is already shown and maps to those one-for-one in Valve's release notes.
- **Resolving Steam's automatic Proton choice** when no `CompatToolMapping` entry exists. That decision is made server-side and is not observable locally; the interface says "automático" instead of guessing.
- **`clinfo`-based VRAM refinement**, and any attempt to fix VRAM reporting for nouveau or Intel iGPUs. `mem_info_vram_total` is amdgpu-only, `clinfo` is not installed by default on most distros, and Task 16 already makes the failure mode honest (no number rather than a wrong one).

---

### Phase 4 verification

- [ ] **Step 1: Full gate**

Run: `npm run verify`
Expected: `validate-tables.js` with no `MISSING` lines, `selfcheck.js` exiting 0, `node --test` with `fail 0`.

- [ ] **Step 2: Confirm no unlabelled Windows block can reach a Linux user**

Run: `node -e "const api=require('./lib/steamApi'); const p=api.pickRequirements({minimum:{os:'Windows 10'},nativeLinux:false},'linux'); console.log(p.reqOs, p.viaProton)"`
Expected: `windows true`

- [ ] **Step 3: Hand-check on Linux, with these specific appids**

- [ ] **427520 (Factorio)** — has a native Linux build. The `SO` chip should show the Ubuntu requirement, not a Windows one; `reqOs` is `linux`; no "via Proton" chip; ProtonDB tier reads PLATINA.
- [ ] **1245620 (Elden Ring)** — Windows-only, its `linux_requirements` is the empty-`<ul>` shape. The comparison runs on the Windows block, the `SO` chip reads `Windows 10 · via Proton`, and a "via Proton" chip appears with whichever build is configured.
- [ ] **1938090 (Call of Duty MWII)** — anti-cheat blocks it. ProtonDB tier reads NÃO RODA even though the machine may clear every hardware requirement. This is the case that justifies the whole feature: confirm the badge is visible enough that a user would not buy the game on the strength of a green comparison alone.
- [ ] **250820 (SteamVR)** — its `linux_requirements` is a bare `[]`. Confirm this does not crash and falls back to the Windows block cleanly.
- [ ] Pull the network cable mid-session and change games: the comparison still renders from cache and the Proton strip simply does not appear. No spinner, no error state, no delay.

---

## Phase 5: Window behavior, capability degradation, and honest UI

**Goal:** Make the overlay tell the truth on Linux. Detect what the current session (X11 vs. Wayland, and which compositor) can actually deliver, stop offering controls that silently do nothing (autostart, always-on-top on GNOME, saved position on any Wayland session), and make it structurally impossible for click-through to strand the user with an unclickable window and no way back.

**Exit criteria:**
- `lib/session.js` classifies Windows / X11 / Wayland+KDE / Wayland+GNOME / Wayland+other and reports six capabilities as `true | false | 'unknown'`, fully covered by `node --test` (no Electron, no display server needed — the whole module reads only `process.platform` and env vars).
- `state.session` rides every `pushState()` push; the renderer reads it.
- Turning on click-through when there is no global shortcut and no confirmed-working tray is impossible from both the settings panel and the tray menu — not just discouraged, refused.
- A Linux-only "desativar transparência" escape hatch exists for the one case this app cannot detect (a compositor-less X11 window manager), defaults off, and is invisible outside X11.
- The window's on-disk position is never written on Wayland.
- `lib/autostart.js` makes "Iniciar com o sistema" actually work on Linux via an XDG autostart entry, covered by `node --test`.
- No remaining UI string implies Windows is the only supported OS.
- `npm run verify` passes throughout.

---

### Task 30: Rename Windows-specific copy to OS-neutral strings

Three strings assume Windows is the only OS this app runs on. None of the logic behind them changes — `no-windows` still means "this game has no Windows build" (still relevant on Linux: no Windows build means Proton has nothing to translate either) — only the wording does.

**Files:**
- Modify: `main.js:356`
- Modify: `index.html:105`
- Modify: `renderer.js:695-699`

- [ ] **Step 1: Implement**

`main.js` — the tray's autostart menu item:

```js
// old (main.js:355-360)
    {
      label: 'Iniciar com o Windows',
      type: 'checkbox',
      checked: prefs.autoStart,
      click: (item) => updateSettings({ autoStart: item.checked }),
    },
```

```js
// new
    {
      label: 'Iniciar com o sistema',
      type: 'checkbox',
      checked: prefs.autoStart,
      click: (item) => updateSettings({ autoStart: item.checked }),
    },
```

`index.html` — the matching settings-panel checkbox:

```html
<!-- old (index.html:105) -->
          <label class="row check"><span>Iniciar com o Windows</span><input id="set-autostart" type="checkbox" /><i class="sw"></i></label>
```

```html
<!-- new -->
          <label class="row check"><span>Iniciar com o sistema</span><input id="set-autostart" type="checkbox" /><i class="sw"></i></label>
```

`renderer.js` — the requirements-error copy:

```js
// old (renderer.js:695-699)
  const errors = {
    network: ['SEM CONEXÃO', 'Não deu para consultar a Steam. Verifique a internet.'],
    'no-windows': ['SEM VERSÃO WINDOWS', 'Este título não é distribuído para Windows.'],
    unavailable: ['REQUISITOS INDISPONÍVEIS', 'Este jogo não expõe requisitos de PC (Windows) na loja.'],
  };
```

```js
// new
  const errors = {
    network: ['SEM CONEXÃO', 'Não deu para consultar a Steam. Verifique a internet.'],
    'no-windows': [
      'SEM VERSÃO WINDOWS',
      'Este título não é distribuído para Windows — sem uma versão Windows, também não há como rodar via Proton.',
    ],
    unavailable: ['REQUISITOS INDISPONÍVEIS', 'Este jogo não expõe requisitos de PC na loja.'],
  };
```

- [ ] **Step 2: Verify**

```bash
node --check main.js && node --check renderer.js && npm run verify
```

Expected: both `--check` calls print nothing (valid syntax) and `npm run verify` ends with `all checks passed`.

```bash
node -e "const m=require('fs').readFileSync('main.js','utf8');const h=require('fs').readFileSync('index.html','utf8');const r=require('fs').readFileSync('renderer.js','utf8');const bad=[[m,'Iniciar com o Windows'],[h,'Iniciar com o Windows'],[r,'(Windows) na loja']];const stale=bad.filter(([s,n])=>s.includes(n));console.log(stale.length?'STALE: still found '+stale.length+' occurrence(s)':'ok: Windows-only wording removed from all three files');"
```

Expected: `ok: Windows-only wording removed from all three files`

- [ ] **Step 3: Commit**

```bash
git add main.js index.html renderer.js && git commit -m "fix(linux): remove Windows-only wording from tray, settings and requirement copy"
```

---

### Task 31: Enable native Wayland via the Ozone platform hint

Without this switch, Electron on a native Wayland session silently runs through XWayland — the app still launches, just without real Wayland integration. The switch has existed since ~Electron 20 and Electron 32 supports it; it only became the default in Electron 38.2, well after this app's pinned `^32.0.0`. It must be set before `app.whenReady()`.

**Files:**
- Modify: `main.js:556` (insert before the single-instance-lock block, still ahead of the `app.whenReady()` call at `main.js:569`)

- [ ] **Step 1: Implement**

```js
// old (main.js:555-559)

// Single-instance lock: relaunching the app re-shows the window. This is the
// safety net if no global accelerator could be registered.
const gotLock = app.requestSingleInstanceLock();
```

```js
// new

// Ozone/Wayland: on a native Wayland session this must run before
// app.whenReady() or Chromium silently falls back to running through
// XWayland — the app still launches, just without real Wayland integration
// (no native transparency on some compositors, blurrier fractional-scaling).
// No-op on Windows/macOS, so the platform guard is just to avoid appending a
// Linux-only flag Chromium has never heard of elsewhere. The env var form
// (ELECTRON_OZONE_PLATFORM_HINT) is deprecated as of Electron 38 — use the
// switch.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}

// Single-instance lock: relaunching the app re-shows the window. This is the
// safety net if no global accelerator could be registered.
const gotLock = app.requestSingleInstanceLock();
```

- [ ] **Step 2: Verify**

```bash
node --check main.js
```

Expected: no output (valid syntax).

```bash
node -e "const s=require('fs').readFileSync('main.js','utf8');const i1=s.indexOf('ozone-platform-hint');const i2=s.indexOf('app.whenReady()');if(i1<0)throw new Error('switch missing');if(i2<0)throw new Error('whenReady missing');if(!(i1<i2))throw new Error('switch appears after whenReady');if(!s.includes(\"process.platform === 'linux'\"))throw new Error('not platform-guarded');console.log('ok: ozone switch is present, platform-guarded, and precedes whenReady');"
```

Expected: `ok: ozone switch is present, platform-guarded, and precedes whenReady`

```bash
npm run verify
```

Expected: ends with `all checks passed`.

- [ ] **Step 3: Commit**

```bash
git add main.js && git commit -m "feat(linux): enable native Wayland via the Ozone platform hint"
```

---

### Task 32: Detect session type, compositor, and per-capability support

This is the core of Linux support: a pure module — no Electron, no shelling out, no display-server calls — that turns `process.platform` and a handful of env vars into a capability matrix everything else in this plan reads from. Deliberately reading `process.platform` directly (rather than importing the earlier-phase `lib/platform`'s `id`) matters for testability: `lib/platform` computes `id` once from the real OS, which would make every Linux branch below permanently unreachable from a test suite run on the maintainer's Windows box. Reading `process.platform` fresh lets tests flip it with `Object.defineProperty`.

**Files:**
- Create: `lib/session.js`
- Test: `test/session.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/session.test.js
'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const session = require('../lib/session');

const ENV_KEYS = ['XDG_SESSION_TYPE', 'XDG_CURRENT_DESKTOP', 'XDG_SESSION_DESKTOP', 'WAYLAND_DISPLAY', 'DISPLAY'];
let savedEnv;
let savedPlatform;

function setPlatform(p) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

beforeEach(() => {
  session._reset();
  savedPlatform = process.platform;
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  setPlatform(savedPlatform);
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  session._reset();
});

test('detect() reports windows with every capability granted', () => {
  setPlatform('win32');
  const s = session.detect();
  assert.equal(s.platform, 'win32');
  assert.equal(s.sessionType, 'windows');
  assert.equal(s.compositing, true);
  assert.equal(s.desktop, null);
  assert.deepEqual(s.capabilities, {
    transparency: true,
    alwaysOnTop: true,
    clickThrough: true,
    globalShortcut: true,
    positioning: true,
    tray: true,
  });
});

test('detect() on X11 assumes compositing and grants every capability', () => {
  setPlatform('linux');
  process.env.XDG_SESSION_TYPE = 'x11';
  const s = session.detect();
  assert.equal(s.platform, 'linux');
  assert.equal(s.sessionType, 'x11');
  assert.equal(s.compositing, true);
  assert.deepEqual(s.capabilities, {
    transparency: true,
    alwaysOnTop: true,
    clickThrough: true,
    globalShortcut: true,
    positioning: true,
    tray: true,
  });
});

test('detect() falls back to DISPLAY for X11 when XDG_SESSION_TYPE is unset', () => {
  setPlatform('linux');
  process.env.DISPLAY = ':0';
  assert.equal(session.detect().sessionType, 'x11');
});

test('detect() falls back to WAYLAND_DISPLAY when XDG_SESSION_TYPE is unset', () => {
  setPlatform('linux');
  process.env.WAYLAND_DISPLAY = 'wayland-0';
  assert.equal(session.detect().sessionType, 'wayland');
});

test('detect() reports an unknown session with unknown capabilities when linux gives no signal at all', () => {
  setPlatform('linux');
  const s = session.detect();
  assert.equal(s.sessionType, 'unknown');
  assert.equal(s.compositing, 'unknown');
  assert.deepEqual(s.capabilities, {
    transparency: 'unknown',
    alwaysOnTop: 'unknown',
    clickThrough: 'unknown',
    globalShortcut: 'unknown',
    positioning: 'unknown',
    tray: 'unknown',
  });
});

test('detect() reports unsupported platforms the same way as an undetermined linux session', () => {
  setPlatform('darwin');
  const s = session.detect();
  assert.equal(s.platform, 'unsupported');
  assert.equal(s.sessionType, 'unknown');
  assert.equal(s.capabilities.globalShortcut, 'unknown');
});

test('detect() on Wayland+KDE loses only globalShortcut and positioning', () => {
  setPlatform('linux');
  process.env.XDG_SESSION_TYPE = 'wayland';
  process.env.XDG_CURRENT_DESKTOP = 'KDE';
  const s = session.detect();
  assert.equal(s.desktop, 'KDE');
  assert.deepEqual(s.capabilities, {
    transparency: true,
    alwaysOnTop: true,
    clickThrough: true,
    globalShortcut: false,
    positioning: false,
    tray: true,
  });
});

test('detect() recognizes "KDE Plasma" as the same family as "KDE"', () => {
  setPlatform('linux');
  process.env.XDG_SESSION_TYPE = 'wayland';
  process.env.XDG_CURRENT_DESKTOP = 'KDE Plasma';
  assert.equal(session.detect().capabilities.alwaysOnTop, true);
});

test('detect() on Wayland+GNOME also loses alwaysOnTop and marks click-through/tray unknown', () => {
  setPlatform('linux');
  process.env.XDG_SESSION_TYPE = 'wayland';
  process.env.XDG_CURRENT_DESKTOP = 'ubuntu:GNOME';
  const s = session.detect();
  assert.equal(s.desktop, 'ubuntu:GNOME');
  assert.deepEqual(s.capabilities, {
    transparency: true,
    alwaysOnTop: false,
    clickThrough: 'unknown',
    globalShortcut: false,
    positioning: false,
    tray: 'unknown',
  });
});

test('detect() finds GNOME regardless of where it sits in the colon-separated list', () => {
  setPlatform('linux');
  process.env.XDG_SESSION_TYPE = 'wayland';
  process.env.XDG_CURRENT_DESKTOP = 'GNOME:ubuntu';
  assert.equal(session.detect().capabilities.alwaysOnTop, false);
});

test('detect() on an unrecognized Wayland compositor only commits to the Wayland-wide losses', () => {
  setPlatform('linux');
  process.env.XDG_SESSION_TYPE = 'wayland';
  process.env.XDG_CURRENT_DESKTOP = 'sway';
  const s = session.detect();
  assert.deepEqual(s.capabilities, {
    transparency: 'unknown',
    alwaysOnTop: 'unknown',
    clickThrough: 'unknown',
    globalShortcut: false,
    positioning: false,
    tray: 'unknown',
  });
});

test('detect() caches until _reset() is called', () => {
  setPlatform('linux');
  process.env.XDG_SESSION_TYPE = 'x11';
  const first = session.detect();
  process.env.XDG_SESSION_TYPE = 'wayland';
  const second = session.detect();
  assert.equal(first, second, 'same cached object must be returned');
  assert.equal(second.sessionType, 'x11', 'a stale env change must not affect an already-cached result');
  session._reset();
  const third = session.detect();
  assert.equal(third.sessionType, 'wayland', 'a fresh detect() after _reset() must re-read the environment');
});

test('canEnableClickThrough refuses only when both the shortcut and the tray are unusable', () => {
  assert.equal(session.canEnableClickThrough({ globalShortcut: true, tray: false }), true);
  assert.equal(session.canEnableClickThrough({ globalShortcut: false, tray: true }), true);
  assert.equal(session.canEnableClickThrough({ globalShortcut: false, tray: false }), false);
  assert.equal(session.canEnableClickThrough({ globalShortcut: false, tray: 'unknown' }), false);
  assert.equal(session.canEnableClickThrough({ globalShortcut: 'unknown', tray: 'unknown' }), true);
  assert.equal(session.canEnableClickThrough(null), true);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/session.test.js`
Expected: FAIL — `Cannot find module '../lib/session'`

- [ ] **Step 3: Implement**

```js
// lib/session.js
'use strict';
// Session type, compositor family, and per-capability support, derived
// purely from environment variables — no shelling out, no talking to the
// display server directly (see capabilitiesFor()'s doc comment on X11
// compositing for why). Reading process.platform directly, rather than
// importing lib/platform's `id`, is deliberate: lib/platform caches `id`
// once at require time from the real OS, which would make every Linux
// branch below permanently unreachable from a test suite that only ever
// runs on the maintainer's Windows dev box. Redefining process.platform with
// Object.defineProperty (see test/session.test.js) works regardless of the
// host OS actually running the tests.

function detectPlatform() {
  if (process.platform === 'win32') return 'win32';
  if (process.platform === 'linux') return 'linux';
  return 'unsupported';
}

function detectSessionType(platform) {
  if (platform === 'win32') return 'windows';
  if (platform !== 'linux') return 'unknown';
  const raw = String(process.env.XDG_SESSION_TYPE || '').toLowerCase();
  if (raw === 'wayland') return 'wayland';
  if (raw === 'x11') return 'x11';
  // XDG_SESSION_TYPE is unset on some minimal window-manager setups; the
  // display socket env vars are still a reliable fallback signal.
  if (process.env.WAYLAND_DISPLAY) return 'wayland';
  if (process.env.DISPLAY) return 'x11';
  return 'unknown';
}

// XDG_CURRENT_DESKTOP is a colon-separated list and vendors don't agree on
// order — Ubuntu ships "ubuntu:GNOME", Kubuntu ships plain "KDE". Scan the
// whole raw string rather than trusting a position.
function desktopFamily(rawDesktop) {
  if (!rawDesktop) return null;
  const d = rawDesktop.toLowerCase();
  if (d.includes('gnome')) return 'gnome';
  if (d.includes('kde') || d.includes('plasma')) return 'kde';
  return 'other';
}

function detectCompositing(sessionType) {
  if (sessionType === 'wayland') return true; // Wayland has no uncomposited mode
  if (sessionType === 'windows') return true; // DWM has been mandatory since Windows 8
  if (sessionType === 'x11') return true; // assumed — see capabilitiesFor()'s doc comment
  return 'unknown';
}

// Every value is true | false | 'unknown'. 'unknown' means "no verified
// answer" and must NOT be treated as false by callers — the click-through
// safety net (Task 34) only trips on a confirmed false.
function capabilitiesFor(sessionType, family) {
  if (sessionType === 'windows' || sessionType === 'x11') {
    // X11 compositing is normally read off ownership of the _NET_WM_CM_S0
    // selection atom, which needs a native X call Electron does not expose.
    // Rather than pull in a native dependency just to catch the rare
    // compositor-less window manager, assume compositing is present — the
    // settings panel's "desativar transparência" pref (Task 35) is the
    // manual override for whoever hits that exception.
    return {
      transparency: true,
      alwaysOnTop: true,
      clickThrough: true,
      globalShortcut: true,
      positioning: true,
      tray: true,
    };
  }
  if (sessionType === 'wayland') {
    // globalShortcut and positioning are lost on every Wayland compositor,
    // not just GNOME/KDE. globalShortcut needs Electron to perform an
    // xdg-desktop-portal Registry.Register handshake it does not implement
    // (electron/electron#51875, no workaround today); positioning has no
    // protocol call at all — no top-level Wayland surface can ask for or set
    // its own screen position. Everything else is compositor-specific, so
    // only the two families this plan's research actually verified get a
    // firm grade.
    const base = { globalShortcut: false, positioning: false };
    if (family === 'kde') {
      // KWin implements wlr-layer-shell, so always-on-top and click-through
      // both work; click-through carries measured 30-290ms input latency,
      // which is a UX footnote, not a capability gap.
      return { ...base, transparency: true, alwaysOnTop: true, clickThrough: true, tray: true };
    }
    if (family === 'gnome') {
      // Mutter is the one major compositor with no layer-shell support, so
      // always-on-top is a hard no, not a degraded yes. Click-through
      // nominally works but Mutter fails to send wl_pointer.leave after an
      // empty input-region commit, so the pointer can stay stuck ignoring
      // the window — not a clean pass. The tray needs a GNOME Shell
      // extension this code has no way to detect.
      return { ...base, transparency: true, alwaysOnTop: false, clickThrough: 'unknown', tray: 'unknown' };
    }
    // A Wayland compositor outside the two verified families (Sway,
    // Hyprland, ...): no researched data, so nothing gets a confident grade
    // beyond the two properties universal to Wayland itself.
    return { ...base, transparency: 'unknown', alwaysOnTop: 'unknown', clickThrough: 'unknown', tray: 'unknown' };
  }
  // Unsupported platform, or a Linux session whose type could not be read.
  return {
    transparency: 'unknown',
    alwaysOnTop: 'unknown',
    clickThrough: 'unknown',
    globalShortcut: 'unknown',
    positioning: 'unknown',
    tray: 'unknown',
  };
}

let cached = null;

function detect() {
  if (cached) return cached;
  const platform = detectPlatform();
  const sessionType = detectSessionType(platform);
  const rawDesktop =
    platform === 'linux' ? process.env.XDG_CURRENT_DESKTOP || process.env.XDG_SESSION_DESKTOP || '' : '';
  const family = sessionType === 'wayland' ? desktopFamily(rawDesktop) : null;
  cached = {
    platform,
    sessionType,
    compositing: detectCompositing(sessionType),
    desktop: rawDesktop || null,
    capabilities: capabilitiesFor(sessionType, family),
  };
  return cached;
}

// Refuses click-through when there would be no way back: no global shortcut
// AND no confirmed-working tray. `tray !== true` (not `=== false`) so an
// 'unknown' tray — e.g. GNOME Wayland without the AppIndicator extension —
// counts as "cannot be relied on", not as "must be proven broken first".
function canEnableClickThrough(capabilities) {
  if (!capabilities) return true;
  if (capabilities.globalShortcut === false && capabilities.tray !== true) return false;
  return true;
}

function _reset() {
  cached = null;
}

module.exports = { detect, canEnableClickThrough, _reset };
```

- [ ] **Step 4: Run the test**

Run: `node --test test/session.test.js`
Expected: PASS — 13 tests

- [ ] **Step 5: Commit**

```bash
git add lib/session.js test/session.test.js && git commit -m "feat(linux): add session type and capability detection"
```

---

### Task 33: Push session capabilities into app state

**Files:**
- Modify: `main.js:1-26` (requires)
- Modify: `main.js:49-69` (the `state` object)
- Modify: `main.js:426-434` (`bootstrap()`)

- [ ] **Step 1: Implement**

```js
// old (main.js:15-26)
const setup = require('./lib/steamSetup');
const dbg = require('./lib/steamDebug');
const steamApi = require('./lib/steamApi');
const { detectSpecs } = require('./lib/detectSpecs');
const compareLib = require('./lib/compare');
const extrasLib = require('./lib/extras');
const fallback = require('./lib/windowFallback');
const settings = require('./lib/settings');
const cache = require('./lib/cache');
const logger = require('./lib/logger');

const log = logger.scoped('main');
```

```js
// new
const setup = require('./lib/steamSetup');
const dbg = require('./lib/steamDebug');
const steamApi = require('./lib/steamApi');
const { detectSpecs } = require('./lib/detectSpecs');
const compareLib = require('./lib/compare');
const extrasLib = require('./lib/extras');
const fallback = require('./lib/windowFallback');
const settings = require('./lib/settings');
const cache = require('./lib/cache');
const logger = require('./lib/logger');
const session = require('./lib/session');

const log = logger.scoped('main');
```

```js
// old (main.js:49-69)
const state = {
  mode: 'starting', // starting | cdp | fallback | setup | no-steam
  cdpPort: null,
  steamRunning: false,
  steamPath: null,
  flagExists: false,
  specs: null,
  game: null, // { appid, title, source, kind }
```

```js
// new
const state = {
  mode: 'starting', // starting | cdp | fallback | setup | no-steam
  cdpPort: null,
  steamRunning: false,
  steamPath: null,
  flagExists: false,
  specs: null,
  session: null, // { platform, sessionType, compositing, desktop, capabilities } from lib/session.detect()
  game: null, // { appid, title, source, kind }
```

```js
// old (main.js:426-434)
async function bootstrap() {
  const prefs = settings.all();
  logger.setLevel(prefs.logLevel);
  state.settings = prefs;
  log.info('starting', app.getVersion());

  tables = compareLib.loadTables();
  createWindow(prefs);
  createTray();
```

```js
// new
async function bootstrap() {
  const prefs = settings.all();
  logger.setLevel(prefs.logLevel);
  state.settings = prefs;
  state.session = session.detect();
  log.info('starting', app.getVersion(), state.session.sessionType, 'compositing:', state.session.compositing);

  tables = compareLib.loadTables();
  createWindow(prefs);
  createTray();
```

- [ ] **Step 2: Verify**

```bash
node --check main.js && npm run verify
```

Expected: `--check` prints nothing; `npm run verify` ends with `all checks passed` (this also confirms `lib/session.js` loads cleanly, via selfcheck's "every lib module loads" gate).

```bash
node -e "const s=require('fs').readFileSync('main.js','utf8');const need=[\"require('./lib/session')\",'session: null','state.session = session.detect()'];const missing=need.filter(n=>!s.includes(n));console.log(missing.length?'MISSING: '+missing.join(', '):'ok: session wiring present in main.js');"
```

Expected: `ok: session wiring present in main.js`

- [ ] **Step 3: Commit**

```bash
git add main.js && git commit -m "feat(linux): push session capabilities to the renderer"
```

---

### Task 34: Refuse click-through when there is no recovery path

`main.js:333-334`'s own comment already names the tray as the last recovery path when click-through is on and no global shortcut registered. On GNOME Wayland the tray may *also* be unreliable (no AppIndicator extension installed) — so a user could enable click-through into a window that ignores every click, with no shortcut and no clickable tray to undo it. The existing single-instance `second-instance` handler (`main.js:562-568`) still re-shows the window as an absolute last resort, but that's not something to rely on as the primary UX.

> **Why:** click-through is the one setting in this app that can make the window unable to receive the very click needed to turn it back off — refusing to arm it beats discovering the trap after the fact, and it costs nothing on every environment where a shortcut or a real tray already exists.

**Files:**
- Modify: `main.js:333-367` (tray comment + `buildTrayMenu()`)
- Modify: `main.js:395-397` (`updateSettings()`)
- Modify: `renderer.js:572-584` (`syncSettings()`) and `renderer.js:586-602` (`settingsHint()`)
- Modify: `renderer.js:620-623` (the `syncSettings` call site)
- Modify: `styles.css` (after line 878)

- [ ] **Step 1: Implement the main.js guard**

```js
// old (main.js:333-360)
// ---- tray ----------------------------------------------------------------
// The tray is the recovery path: if click-through is on and no global shortcut
// could be registered, this menu is the only way back to a usable window.
function buildTrayMenu() {
  const prefs = settings.all();
  return Menu.buildFromTemplate([
    {
      label: win && win.isVisible() ? 'Esconder overlay' : 'Mostrar overlay',
      click: toggleWindow,
    },
    { type: 'separator' },
    {
      label: 'Sempre no topo',
      type: 'checkbox',
      checked: prefs.alwaysOnTop,
      click: (item) => updateSettings({ alwaysOnTop: item.checked }),
    },
    {
      label: 'Modo click-through',
      type: 'checkbox',
      checked: prefs.clickThrough,
      click: (item) => updateSettings({ clickThrough: item.checked }),
    },
```

```js
// new
// ---- tray ----------------------------------------------------------------
// The tray is the recovery path: if click-through is on and no global shortcut
// could be registered, this menu is the only way back to a usable window. On a
// session where the tray itself is not guaranteed either (GNOME Wayland
// without the AppIndicator extension), updateSettings() below refuses to
// enable click-through in the first place instead of relying on this menu.
function buildTrayMenu() {
  const prefs = settings.all();
  const clickThroughOk = prefs.clickThrough || session.canEnableClickThrough(state.session && state.session.capabilities);
  return Menu.buildFromTemplate([
    {
      label: win && win.isVisible() ? 'Esconder overlay' : 'Mostrar overlay',
      click: toggleWindow,
    },
    { type: 'separator' },
    {
      label: 'Sempre no topo',
      type: 'checkbox',
      checked: prefs.alwaysOnTop,
      click: (item) => updateSettings({ alwaysOnTop: item.checked }),
    },
    {
      label: 'Modo click-through',
      type: 'checkbox',
      checked: prefs.clickThrough,
      enabled: clickThroughOk,
      click: (item) => updateSettings({ clickThrough: item.checked }),
    },
```

```js
// old (main.js:395-397)
function updateSettings(changes) {
  const changed = settings.patch(changes);
  if (Object.keys(changed).length === 0) return settings.all();
```

```js
// new
function updateSettings(changes) {
  // Single chokepoint for both the settings panel and the tray menu's "Modo
  // click-through" item, so this guard cannot be bypassed by whichever one
  // the user didn't click. Refuses rather than silently ignoring: without a
  // global shortcut AND a tray that is actually clickable, click-through
  // would have no way back — see lib/session.js's canEnableClickThrough().
  if (changes && changes.clickThrough === true) {
    const caps = state.session && state.session.capabilities;
    if (!session.canEnableClickThrough(caps)) changes = { ...changes, clickThrough: false };
  }
  const changed = settings.patch(changes);
  if (Object.keys(changed).length === 0) return settings.all();
```

- [ ] **Step 2: Implement the renderer.js UI**

```js
// old (renderer.js:572-584)
// ---- settings ------------------------------------------------------------
function syncSettings(prefs) {
  if (!prefs) return;
  $('#set-opacity').value = String(Math.round(prefs.opacity * 100));
  $('#set-opacity-val').textContent = `${Math.round(prefs.opacity * 100)}%`;
  $('#set-ontop').checked = prefs.alwaysOnTop;
  $('#set-click').checked = prefs.clickThrough;
  $('#set-compact').checked = prefs.compact;
  $('#set-art').checked = prefs.showArtwork;
  $('#set-autostart').checked = prefs.autoStart;
  $('#set-reqtype').value = prefs.reqType;
  app.classList.toggle('compact', !!prefs.compact);
}
```

```js
// new
// ---- settings ------------------------------------------------------------
// Click-through has no recovery path without either a global shortcut or a
// tray the user can actually click — same rule main.js enforces server-side
// in updateSettings(). Checking it again here just keeps the checkbox honest
// about what a click would do; main.js is what actually prevents the trap.
function clickThroughAllowed(session) {
  if (!session || !session.capabilities) return true;
  const caps = session.capabilities;
  return !(caps.globalShortcut === false && caps.tray !== true);
}

function syncSettings(prefs, session) {
  if (!prefs) return;
  $('#set-opacity').value = String(Math.round(prefs.opacity * 100));
  $('#set-opacity-val').textContent = `${Math.round(prefs.opacity * 100)}%`;
  $('#set-ontop').checked = prefs.alwaysOnTop;
  $('#set-click').checked = prefs.clickThrough;
  $('#set-compact').checked = prefs.compact;
  $('#set-art').checked = prefs.showArtwork;
  $('#set-autostart').checked = prefs.autoStart;
  $('#set-reqtype').value = prefs.reqType;
  app.classList.toggle('compact', !!prefs.compact);

  const clickOk = prefs.clickThrough || clickThroughAllowed(session);
  $('#set-click').disabled = !clickOk;
  $('#set-click').closest('.row').classList.toggle('disabled', !clickOk);
}
```

```js
// old (renderer.js:586-602)
function settingsHint(state) {
  const parts = [];
  parts.push(
    state.shortcut
      ? `Atalho global: ${state.shortcut.replace('CommandOrControl', 'Ctrl')}`
      : 'Nenhum atalho global disponível — use o ícone da bandeja.'
  );
  if (state.settings && state.settings.clickThrough) {
    parts.push(
      state.clickThroughShortcut
        ? `Click-through ligado — ${state.clickThroughShortcut.replace('CommandOrControl', 'Ctrl')} desliga.`
        : 'Com click-through ligado, desligue pelo menu da bandeja.'
    );
  }
  parts.push(`v${state.version || '?'}`);
  return parts.join('  ·  ');
}
```

```js
// new
function settingsHint(state) {
  const parts = [];
  parts.push(
    state.shortcut
      ? `Atalho global: ${state.shortcut.replace('CommandOrControl', 'Ctrl')}`
      : 'Nenhum atalho global disponível — use o ícone da bandeja.'
  );
  if (state.settings && state.settings.clickThrough) {
    parts.push(
      state.clickThroughShortcut
        ? `Click-through ligado — ${state.clickThroughShortcut.replace('CommandOrControl', 'Ctrl')} desliga.`
        : 'Com click-through ligado, desligue pelo menu da bandeja.'
    );
  } else if (!clickThroughAllowed(state.session)) {
    parts.push('Click-through indisponível: sem atalho global e sem bandeja confiável aqui.');
  }
  parts.push(`v${state.version || '?'}`);
  return parts.join('  ·  ');
}
```

```js
// old (renderer.js:620-623, inside render())
  if (state.settings) {
    if (reqType === null) reqType = state.settings.reqType;
    syncSettings(state.settings);
  }
```

```js
// new
  if (state.settings) {
    if (reqType === null) reqType = state.settings.reqType;
    syncSettings(state.settings, state.session);
  }
```

- [ ] **Step 3: Implement the disabled-checkbox style**

```css
/* old (styles.css:877-880) */
.settings input[type="checkbox"]:checked + .sw { background: color-mix(in srgb, var(--accent) 30%, var(--rule)); }
.settings input[type="checkbox"]:checked + .sw::after { transform: translateX(11px); background: var(--accent); }

.settings select {
```

```css
/* new */
.settings input[type="checkbox"]:checked + .sw { background: color-mix(in srgb, var(--accent) 30%, var(--rule)); }
.settings input[type="checkbox"]:checked + .sw::after { transform: translateX(11px); background: var(--accent); }

/* Linux capability gaps: a checkbox that would immediately be refused (or
   would silently do nothing) reads as broken UI unless it looks disabled. */
.settings .row.check.disabled { cursor: not-allowed; opacity: 0.5; }
.settings .row.check.disabled .sw { cursor: not-allowed; }

.settings select {
```

- [ ] **Step 4: Verify**

```bash
node --check main.js && node --check renderer.js && node scripts/selfcheck.js
```

Expected: both `--check` calls silent; selfcheck ends with `all checks passed`.

```bash
node -e "const m=require('fs').readFileSync('main.js','utf8');const r=require('fs').readFileSync('renderer.js','utf8');const c=require('fs').readFileSync('styles.css','utf8');const need=[[m,'session.canEnableClickThrough'],[m,'clickThrough: false'],[r,'function clickThroughAllowed'],[r,\"closest('.row')\"],[c,'.row.check.disabled']];const missing=need.filter(([s,n])=>!s.includes(n));console.log(missing.length?'MISSING: '+missing.map(x=>x[1]).join(', '):'ok: click-through safety net wired in main.js, renderer.js and styles.css');"
```

Expected: `ok: click-through safety net wired in main.js, renderer.js and styles.css`

This can only be truly exercised end-to-end on a real GNOME Wayland session with no AppIndicator extension installed — see the Phase 5 verification hand-check list below.

- [ ] **Step 5: Commit**

```bash
git add main.js renderer.js styles.css && git commit -m "fix(linux): refuse click-through with no recovery path"
```

---

### Task 35: Add a transparency escape hatch for uncomposited X11

Compositing on X11 is normally read off ownership of the `_NET_WM_CM_S0` selection atom, which needs a native X call Electron doesn't expose. `lib/session.js` (Task 32) deliberately assumes compositing is present on X11 rather than pulling in a native dependency to catch the rare exception. This task is that assumption's release valve: a persisted pref that forces `transparent: false` — which only takes effect on the next launch, since Electron has no live setter for a window's `transparent` flag.

> **Why:** shipping a "no compositor detected" state we cannot actually verify would be worse than not detecting it at all — a false positive would hide transparency from users whose X11 session is fine. Assuming compositing and giving the minority an opt-out is more honest than guessing.

**Files:**
- Modify: `lib/settings.js` (`DEFAULTS` and `sanitize()`)
- Modify: `test/storage.test.js`
- Modify: `main.js` (`createWindow()`)
- Modify: `index.html` (new checkbox row)
- Modify: `renderer.js` (`syncSettings()` and the event-listener block)

- [ ] **Step 1: Write the failing test**

```js
// add to test/storage.test.js, right after the existing
// 'sanitize caps opacity at 1 and keeps valid coordinates' test
test('sanitize keeps disableTransparency a boolean, defaulting to false', () => {
  assert.equal(settings.sanitize({}).disableTransparency, false);
  assert.equal(settings.sanitize({ disableTransparency: true }).disableTransparency, true);
  assert.equal(settings.sanitize({ disableTransparency: 'yes' }).disableTransparency, false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/storage.test.js`
Expected: FAIL — `AssertionError` (`disableTransparency` is `undefined`, not `false`)

- [ ] **Step 3: Implement lib/settings.js**

```js
// old (lib/settings.js:9-21)
const DEFAULTS = {
  version: 1,
  x: null, // null = compute default corner position
  y: null,
  opacity: 1,
  alwaysOnTop: true,
  clickThrough: false,
  reqType: 'recommended', // which block the overlay opens on
  autoStart: false,
  showArtwork: true,
  compact: false,
  logLevel: 'info',
};
```

```js
// new
const DEFAULTS = {
  version: 1,
  x: null, // null = compute default corner position
  y: null,
  opacity: 1,
  alwaysOnTop: true,
  clickThrough: false,
  reqType: 'recommended', // which block the overlay opens on
  autoStart: false,
  showArtwork: true,
  compact: false,
  disableTransparency: false, // Linux X11 escape hatch for a compositor-less WM — see lib/session.js
  logLevel: 'info',
};
```

```js
// old (lib/settings.js:44-59)
function sanitize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    version: 1,
    x: coord(r.x),
    y: coord(r.y),
    opacity: clampNum(r.opacity, MIN_OPACITY, 1, DEFAULTS.opacity),
    alwaysOnTop: bool(r.alwaysOnTop, DEFAULTS.alwaysOnTop),
    clickThrough: bool(r.clickThrough, DEFAULTS.clickThrough),
    reqType: r.reqType === 'minimum' ? 'minimum' : 'recommended',
    autoStart: bool(r.autoStart, DEFAULTS.autoStart),
    showArtwork: bool(r.showArtwork, DEFAULTS.showArtwork),
    compact: bool(r.compact, DEFAULTS.compact),
    logLevel: ['error', 'warn', 'info', 'debug'].includes(r.logLevel) ? r.logLevel : DEFAULTS.logLevel,
  };
}
```

```js
// new
function sanitize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    version: 1,
    x: coord(r.x),
    y: coord(r.y),
    opacity: clampNum(r.opacity, MIN_OPACITY, 1, DEFAULTS.opacity),
    alwaysOnTop: bool(r.alwaysOnTop, DEFAULTS.alwaysOnTop),
    clickThrough: bool(r.clickThrough, DEFAULTS.clickThrough),
    reqType: r.reqType === 'minimum' ? 'minimum' : 'recommended',
    autoStart: bool(r.autoStart, DEFAULTS.autoStart),
    showArtwork: bool(r.showArtwork, DEFAULTS.showArtwork),
    compact: bool(r.compact, DEFAULTS.compact),
    disableTransparency: bool(r.disableTransparency, DEFAULTS.disableTransparency),
    logLevel: ['error', 'warn', 'info', 'debug'].includes(r.logLevel) ? r.logLevel : DEFAULTS.logLevel,
  };
}
```

- [ ] **Step 4: Run the test**

Run: `node --test test/storage.test.js`
Expected: PASS — 11 tests

- [ ] **Step 5: Implement main.js**

```js
// old (main.js:295-319, inside createWindow())
  win = new BrowserWindow({
    width: WIN_W,
    height,
    x: pos.x,
    y: pos.y,
    minWidth: WIN_W,
    maxWidth: WIN_W,
    minHeight: WIN_H_COMPACT,
    maxHeight: WIN_H,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    alwaysOnTop: prefs.alwaysOnTop,
    show: false,
    icon: iconPath('icon.png'),
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
```

```js
// new
  win = new BrowserWindow({
    width: WIN_W,
    height,
    x: pos.x,
    y: pos.y,
    minWidth: WIN_W,
    maxWidth: WIN_W,
    minHeight: WIN_H_COMPACT,
    maxHeight: WIN_H,
    frame: false,
    // `transparent` is fixed at construction time — Electron has no live
    // setter for it, which is why this pref only takes effect on the next
    // launch (the settings panel label says so). It exists for the one case
    // this app cannot detect: an X11 window manager with no compositor,
    // where a transparent window paints solid black instead of see-through.
    transparent: !prefs.disableTransparency,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    alwaysOnTop: prefs.alwaysOnTop,
    show: false,
    icon: iconPath('icon.png'),
    backgroundColor: prefs.disableTransparency ? '#080b10' : '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
```

- [ ] **Step 6: Implement index.html**

```html
<!-- old (index.html:104-106) -->
          <label class="row check"><span>Mostrar arte do jogo</span><input id="set-art" type="checkbox" /><i class="sw"></i></label>
          <label class="row check"><span>Iniciar com o sistema</span><input id="set-autostart" type="checkbox" /><i class="sw"></i></label>
          <label class="row">
```

```html
<!-- new -->
          <label class="row check"><span>Mostrar arte do jogo</span><input id="set-art" type="checkbox" /><i class="sw"></i></label>
          <label class="row check"><span>Iniciar com o sistema</span><input id="set-autostart" type="checkbox" /><i class="sw"></i></label>
          <label id="set-notransparency-row" class="row check" hidden>
            <span>Desativar transparência (reinicia)</span><input id="set-notransparency" type="checkbox" /><i class="sw"></i>
          </label>
          <label class="row">
```

- [ ] **Step 7: Implement renderer.js**

```js
// old (post-Task-34 syncSettings, renderer.js)
function syncSettings(prefs, session) {
  if (!prefs) return;
  $('#set-opacity').value = String(Math.round(prefs.opacity * 100));
  $('#set-opacity-val').textContent = `${Math.round(prefs.opacity * 100)}%`;
  $('#set-ontop').checked = prefs.alwaysOnTop;
  $('#set-click').checked = prefs.clickThrough;
  $('#set-compact').checked = prefs.compact;
  $('#set-art').checked = prefs.showArtwork;
  $('#set-autostart').checked = prefs.autoStart;
  $('#set-reqtype').value = prefs.reqType;
  app.classList.toggle('compact', !!prefs.compact);

  const clickOk = prefs.clickThrough || clickThroughAllowed(session);
  $('#set-click').disabled = !clickOk;
  $('#set-click').closest('.row').classList.toggle('disabled', !clickOk);
}
```

```js
// new
function syncSettings(prefs, session) {
  if (!prefs) return;
  $('#set-opacity').value = String(Math.round(prefs.opacity * 100));
  $('#set-opacity-val').textContent = `${Math.round(prefs.opacity * 100)}%`;
  $('#set-ontop').checked = prefs.alwaysOnTop;
  $('#set-click').checked = prefs.clickThrough;
  $('#set-compact').checked = prefs.compact;
  $('#set-art').checked = prefs.showArtwork;
  $('#set-autostart').checked = prefs.autoStart;
  $('#set-notransparency').checked = prefs.disableTransparency;
  $('#set-reqtype').value = prefs.reqType;
  app.classList.toggle('compact', !!prefs.compact);

  // Only X11 needs this: it is the one session type this app cannot probe
  // for a running compositor (see lib/session.js), so a compositor-less
  // window manager would otherwise show a solid black window with no clue
  // why. Wayland has no uncomposited mode, so the pref would be a no-op
  // there — hide it rather than offer a setting that cannot do anything.
  show($('#set-notransparency-row'), !!(session && session.sessionType === 'x11'));

  const clickOk = prefs.clickThrough || clickThroughAllowed(session);
  $('#set-click').disabled = !clickOk;
  $('#set-click').closest('.row').classList.toggle('disabled', !clickOk);
}
```

```js
// old (renderer.js, event-listener block)
$('#set-autostart').addEventListener('change', (e) => window.api.setSettings({ autoStart: e.target.checked }));
$('#set-reqtype').addEventListener('change', (e) => {
```

```js
// new
$('#set-autostart').addEventListener('change', (e) => window.api.setSettings({ autoStart: e.target.checked }));
$('#set-notransparency').addEventListener('change', (e) => window.api.setSettings({ disableTransparency: e.target.checked }));
$('#set-reqtype').addEventListener('change', (e) => {
```

- [ ] **Step 8: Verify**

```bash
node --check main.js && node --check renderer.js && npm run verify
```

Expected: both `--check` calls silent; `npm run verify` ends with `all checks passed`.

```bash
node -e "const m=require('fs').readFileSync('main.js','utf8');const h=require('fs').readFileSync('index.html','utf8');const r=require('fs').readFileSync('renderer.js','utf8');const need=[[m,'prefs.disableTransparency'],[h,'set-notransparency'],[r,'disableTransparency: e.target.checked']];const missing=need.filter(([s,n])=>!s.includes(n));console.log(missing.length?'MISSING':'ok: transparency escape hatch wired end to end');"
```

Expected: `ok: transparency escape hatch wired end to end`

- [ ] **Step 9: Commit**

```bash
git add lib/settings.js test/storage.test.js main.js index.html renderer.js && git commit -m "feat(linux): add a transparency escape hatch for uncomposited X11"
```

---

### Task 36: Stop persisting window position on Wayland

`resolvePosition()` (`main.js:243-258`) already degrades gracefully when `prefs.x`/`prefs.y` are `null` — it falls back to a corner position. Wayland gives no client a way to ask for or set its own screen position, so `win.getPosition()` inside `persistPosition()` would just echo back whatever coordinate Electron made up, and writing that would overwrite a real position saved from a previous X11 session with noise.

**Files:**
- Modify: `main.js:277-286` (`persistPosition()`)

- [ ] **Step 1: Implement**

```js
// old
function persistPosition() {
  if (!win || win.isDestroyed()) return;
  if (moveTimer) clearTimeout(moveTimer);
  moveTimer = setTimeout(() => {
    moveTimer = null;
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    settings.patch({ x, y });
  }, 500);
}
```

```js
// new
function persistPosition() {
  if (!win || win.isDestroyed()) return;
  // Wayland has no protocol call for a client to ask for or set its own
  // screen position, so win.getPosition() below would just be echoing back
  // whatever coordinate Electron made up — saving it would overwrite a real
  // position from a previous X11 session with garbage.
  if (state.session && state.session.capabilities.positioning === false) return;
  if (moveTimer) clearTimeout(moveTimer);
  moveTimer = setTimeout(() => {
    moveTimer = null;
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    settings.patch({ x, y });
  }, 500);
}
```

- [ ] **Step 2: Verify**

```bash
node --check main.js && npm run verify
```

Expected: `--check` silent; `npm run verify` ends with `all checks passed`.

```bash
node -e "const s=require('fs').readFileSync('main.js','utf8');if(!s.includes('capabilities.positioning === false'))throw new Error('guard missing');console.log('ok: position persistence is gated on the Wayland capability');"
```

Expected: `ok: position persistence is gated on the Wayland capability`

- [ ] **Step 3: Commit**

```bash
git add main.js && git commit -m "fix(linux): stop persisting window position on Wayland"
```

---

### Task 37: Surface Linux capability limits in the settings panel

The click-through checkbox (Task 34) and the transparency escape hatch (Task 35) are covered; this task greys out "Sempre no topo" when the compositor cannot honor it (GNOME/Mutter has no layer-shell) and extends the visible hint line at the bottom of the settings panel with what else this specific Wayland session takes away — tray reliability and saved position — so a degraded checkbox is explained instead of just looking broken.

**Files:**
- Modify: `renderer.js` (`syncSettings()`, plus a new `sessionNote()` helper feeding `settingsHint()`)

- [ ] **Step 1: Implement**

```js
// old (post-Task-35 syncSettings, renderer.js)
function syncSettings(prefs, session) {
  if (!prefs) return;
  $('#set-opacity').value = String(Math.round(prefs.opacity * 100));
  $('#set-opacity-val').textContent = `${Math.round(prefs.opacity * 100)}%`;
  $('#set-ontop').checked = prefs.alwaysOnTop;
  $('#set-click').checked = prefs.clickThrough;
  $('#set-compact').checked = prefs.compact;
  $('#set-art').checked = prefs.showArtwork;
  $('#set-autostart').checked = prefs.autoStart;
  $('#set-notransparency').checked = prefs.disableTransparency;
  $('#set-reqtype').value = prefs.reqType;
  app.classList.toggle('compact', !!prefs.compact);

  show($('#set-notransparency-row'), !!(session && session.sessionType === 'x11'));

  const clickOk = prefs.clickThrough || clickThroughAllowed(session);
  $('#set-click').disabled = !clickOk;
  $('#set-click').closest('.row').classList.toggle('disabled', !clickOk);
}
```

```js
// new
function syncSettings(prefs, session) {
  if (!prefs) return;
  $('#set-opacity').value = String(Math.round(prefs.opacity * 100));
  $('#set-opacity-val').textContent = `${Math.round(prefs.opacity * 100)}%`;
  $('#set-ontop').checked = prefs.alwaysOnTop;
  $('#set-click').checked = prefs.clickThrough;
  $('#set-compact').checked = prefs.compact;
  $('#set-art').checked = prefs.showArtwork;
  $('#set-autostart').checked = prefs.autoStart;
  $('#set-notransparency').checked = prefs.disableTransparency;
  $('#set-reqtype').value = prefs.reqType;
  app.classList.toggle('compact', !!prefs.compact);

  show($('#set-notransparency-row'), !!(session && session.sessionType === 'x11'));

  const clickOk = prefs.clickThrough || clickThroughAllowed(session);
  $('#set-click').disabled = !clickOk;
  $('#set-click').closest('.row').classList.toggle('disabled', !clickOk);

  // Mutter (GNOME's compositor) has no layer-shell, so always-on-top cannot
  // work at all there — greying the checkbox out is the honest option
  // instead of a toggle that flips on and quietly does nothing.
  const ontopOk = !session || session.capabilities.alwaysOnTop !== false;
  $('#set-ontop').disabled = !ontopOk;
  $('#set-ontop').closest('.row').classList.toggle('disabled', !ontopOk);
}

// Summarizes what this specific Wayland compositor is known to take away, so
// the settings panel explains a greyed-out checkbox instead of leaving the
// user to guess why it will not respond. Nothing to say on Windows or X11 —
// both are treated as fully capable (see lib/session.js for the X11
// assumption this rests on).
function sessionNote(session) {
  if (!session || session.sessionType !== 'wayland') return null;
  const caps = session.capabilities;
  const lost = [];
  if (caps.alwaysOnTop === false) lost.push('sempre-no-topo indisponível');
  if (caps.positioning === false) lost.push('posição não é salva');
  if (caps.tray === 'unknown') lost.push('bandeja pode exigir extensão');
  if (lost.length === 0) return null;
  const label = session.desktop ? `Wayland/${session.desktop.split(':').pop()}` : 'Wayland';
  return `${label}: ${lost.join(', ')}.`;
}
```

```js
// old (post-Task-34 settingsHint, renderer.js)
function settingsHint(state) {
  const parts = [];
  parts.push(
    state.shortcut
      ? `Atalho global: ${state.shortcut.replace('CommandOrControl', 'Ctrl')}`
      : 'Nenhum atalho global disponível — use o ícone da bandeja.'
  );
  if (state.settings && state.settings.clickThrough) {
    parts.push(
      state.clickThroughShortcut
        ? `Click-through ligado — ${state.clickThroughShortcut.replace('CommandOrControl', 'Ctrl')} desliga.`
        : 'Com click-through ligado, desligue pelo menu da bandeja.'
    );
  } else if (!clickThroughAllowed(state.session)) {
    parts.push('Click-through indisponível: sem atalho global e sem bandeja confiável aqui.');
  }
  parts.push(`v${state.version || '?'}`);
  return parts.join('  ·  ');
}
```

```js
// new
function settingsHint(state) {
  const parts = [];
  parts.push(
    state.shortcut
      ? `Atalho global: ${state.shortcut.replace('CommandOrControl', 'Ctrl')}`
      : 'Nenhum atalho global disponível — use o ícone da bandeja.'
  );
  if (state.settings && state.settings.clickThrough) {
    parts.push(
      state.clickThroughShortcut
        ? `Click-through ligado — ${state.clickThroughShortcut.replace('CommandOrControl', 'Ctrl')} desliga.`
        : 'Com click-through ligado, desligue pelo menu da bandeja.'
    );
  } else if (!clickThroughAllowed(state.session)) {
    parts.push('Click-through indisponível: sem atalho global e sem bandeja confiável aqui.');
  }
  const note = sessionNote(state.session);
  if (note) parts.push(note);
  parts.push(`v${state.version || '?'}`);
  return parts.join('  ·  ');
}
```

- [ ] **Step 2: Verify**

```bash
node --check renderer.js && npm run verify
```

Expected: `--check` silent; `npm run verify` ends with `all checks passed`.

```bash
node -e "const r=require('fs').readFileSync('renderer.js','utf8');const need=['function sessionNote','set-ontop\').disabled','capabilities.alwaysOnTop !== false'];const missing=need.filter(n=>!r.includes(n));console.log(missing.length?'MISSING: '+missing.join(', '):'ok: always-on-top greying and the Wayland hint line are wired');"
```

Expected: `ok: always-on-top greying and the Wayland hint line are wired`

- [ ] **Step 3: Commit**

```bash
git add renderer.js && git commit -m "feat(linux): surface capability limitations in the settings panel"
```

---

### Task 38: Manage an XDG autostart entry on Linux

`app.setLoginItemSettings` (used today in `applyAutoStart`, `main.js:387-393`) is documented Windows/macOS-only — on Linux it is an inert no-op wrapped in a try/catch that never throws, so nothing crashes, but "Iniciar com o sistema" silently does nothing. This module writes the file every XDG-compliant desktop (GNOME, KDE, XFCE, ...) reads on login: `~/.config/autostart/steam-spec-overlay.desktop` (`$XDG_CONFIG_HOME/autostart` when that's set).

> **Why:** `process.execPath` under an AppImage points inside a temporary FUSE mount that stops existing the moment the app closes, so a login item built from it would silently fail on the very next boot. `$APPIMAGE` is the real, user-visible path electron-builder's AppImage launcher sets before exec'ing into the mount, so it has to win when present.

**Files:**
- Create: `lib/autostart.js`
- Test: `test/autostart.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/autostart.test.js
'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const autostart = require('../lib/autostart');

let tmp;
let savedConfigHome;
let savedAppImage;
let savedExecPath;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sso-autostart-'));
  savedConfigHome = process.env.XDG_CONFIG_HOME;
  savedAppImage = process.env.APPIMAGE;
  savedExecPath = process.execPath;
  process.env.XDG_CONFIG_HOME = tmp;
  delete process.env.APPIMAGE;
  process.execPath = '/usr/bin/steam-spec-overlay';
});

afterEach(() => {
  if (savedConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedConfigHome;
  if (savedAppImage === undefined) delete process.env.APPIMAGE;
  else process.env.APPIMAGE = savedAppImage;
  process.execPath = savedExecPath;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('desktopFilePath lives under XDG_CONFIG_HOME/autostart', () => {
  assert.equal(autostart.desktopFilePath(), path.join(tmp, 'autostart', 'steam-spec-overlay.desktop'));
});

test('apply(true) writes a valid XDG desktop entry pointed at process.execPath', async () => {
  const ok = await autostart.apply(true);
  assert.equal(ok, true);
  assert.equal(autostart.isEnabled(), true);
  const body = fs.readFileSync(autostart.desktopFilePath(), 'utf8');
  assert.match(body, /^\[Desktop Entry\]/);
  assert.match(body, /Type=Application/);
  assert.match(body, /Exec="\/usr\/bin\/steam-spec-overlay" --hidden/);
  assert.match(body, /Icon=steam-spec-overlay/);
  assert.match(body, /X-GNOME-Autostart-enabled=true/);
});

test('apply(true) prefers $APPIMAGE over process.execPath', async () => {
  process.env.APPIMAGE = '/home/user/Downloads/Steam-Spec-Overlay.AppImage';
  await autostart.apply(true);
  const body = fs.readFileSync(autostart.desktopFilePath(), 'utf8');
  assert.match(body, /Exec="\/home\/user\/Downloads\/Steam-Spec-Overlay\.AppImage" --hidden/);
});

test('apply(false) removes the entry and is idempotent when already absent', async () => {
  await autostart.apply(true);
  assert.equal(autostart.isEnabled(), true);
  assert.equal(await autostart.apply(false), true);
  assert.equal(autostart.isEnabled(), false);
  assert.equal(await autostart.apply(false), true, 'disabling an already-disabled entry must still report success');
});

test('isEnabled reflects the file on disk, not any in-memory flag', () => {
  assert.equal(autostart.isEnabled(), false);
  fs.mkdirSync(path.dirname(autostart.desktopFilePath()), { recursive: true });
  fs.writeFileSync(autostart.desktopFilePath(), 'placeholder');
  assert.equal(autostart.isEnabled(), true);
});

test('apply() reports failure instead of throwing when the target cannot be written', async () => {
  const blocker = path.join(tmp, 'blocked');
  fs.writeFileSync(blocker, ''); // a file where a directory is expected
  process.env.XDG_CONFIG_HOME = blocker;
  const ok = await autostart.apply(true);
  assert.equal(ok, false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/autostart.test.js`
Expected: FAIL — `Cannot find module '../lib/autostart'`

- [ ] **Step 3: Implement**

```js
// lib/autostart.js
'use strict';
// XDG autostart entry for Linux (freedesktop.org autostart spec 0.5).
// app.setLoginItemSettings (see main.js's applyAutoStart) is documented
// Windows/macOS-only — on Linux it is an inert no-op, so without this file
// the "Iniciar com o sistema" checkbox would flip, persist to settings, and
// silently do nothing. This writes the one file XDG-compliant desktops
// (GNOME, KDE, XFCE, ...) all read on login: ~/.config/autostart/<id>.desktop.

const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_ID = 'steam-spec-overlay';

function autostartDir() {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, 'autostart');
}

function desktopFilePath() {
  return path.join(autostartDir(), `${APP_ID}.desktop`);
}

// AppImage re-execs the real binary from a temporary FUSE mount
// (/tmp/.mount_XXXX/...) and sets process.execPath to that path — which
// stops existing the moment the app closes. A login item pointed there would
// silently fail on the very next boot. $APPIMAGE is the variable
// electron-builder's AppImage launcher sets to the real, user-visible
// .AppImage file before exec'ing into the mount, so prefer it when present.
function execTarget() {
  return process.env.APPIMAGE || process.execPath;
}

function fileBody() {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    'Name=Steam Spec Overlay',
    'Comment=Compara os requisitos do jogo aberto na Steam com o seu PC',
    `Exec="${execTarget()}" --hidden`,
    'Icon=steam-spec-overlay',
    'Terminal=false',
    'Hidden=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

function isEnabled() {
  return fs.existsSync(desktopFilePath());
}

// Returns true once the on-disk entry actually matches `enabled` — false on
// any failure (read-only home, missing permissions, ...) so main.js can log
// it instead of reporting success it cannot back up.
async function apply(enabled) {
  const file = desktopFilePath();
  try {
    if (enabled) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, fileBody());
    } else if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
    return isEnabled() === enabled;
  } catch {
    return false;
  }
}

module.exports = { apply, isEnabled, desktopFilePath };
```

- [ ] **Step 4: Run the test**

Run: `node --test test/autostart.test.js`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add lib/autostart.js test/autostart.test.js && git commit -m "feat(linux): add XDG autostart entry management"
```

---

### Task 39: Wire autostart through main.js on Linux

**Files:**
- Modify: `main.js` (requires block, and `applyAutoStart()` at `main.js:387-393`)

- [ ] **Step 1: Implement**

```js
// old (post-Task-33 requires, main.js)
const logger = require('./lib/logger');
const session = require('./lib/session');

const log = logger.scoped('main');
```

```js
// new
const logger = require('./lib/logger');
const session = require('./lib/session');
const autostart = require('./lib/autostart');

const log = logger.scoped('main');
```

```js
// old (main.js:386-393)
// ---- settings ------------------------------------------------------------
function applyAutoStart(enabled) {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
  } catch (e) {
    log.warn('could not set login item', e);
  }
}
```

```js
// new
// ---- settings ------------------------------------------------------------
async function applyAutoStart(enabled) {
  if (process.platform === 'linux') {
    // app.setLoginItemSettings is a documented Windows/macOS-only API — on
    // Linux Electron accepts the call and does nothing, which used to mean
    // this checkbox lied. autostart.apply() is what actually writes (or
    // removes) the XDG autostart entry.
    const ok = await autostart.apply(enabled);
    if (!ok) log.warn('could not write the Linux autostart entry');
    return;
  }
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
  } catch (e) {
    log.warn('could not set login item', e);
  }
}
```

The call site (`main.js`, inside `updateSettings()`) stays exactly as `if ('autoStart' in changed) applyAutoStart(prefs.autoStart);` — still fire-and-forget, same as before `applyAutoStart` became `async`; failures are logged inside it, not thrown outward, so nothing needs to change at the call site.

- [ ] **Step 2: Verify**

```bash
node --check main.js && npm run verify
```

Expected: `--check` silent; `npm run verify` ends with `all checks passed` (selfcheck's "every lib module loads" gate now also covers `lib/autostart.js`).

```bash
node -e "const s=require('fs').readFileSync('main.js','utf8');const need=[\"require('./lib/autostart')\",\"process.platform === 'linux'\",'autostart.apply(enabled)'];const missing=need.filter(n=>!s.includes(n));console.log(missing.length?'MISSING: '+missing.join(', '):'ok: autostart wired into main.js for Linux');"
```

Expected: `ok: autostart wired into main.js for Linux`

- [ ] **Step 3: Commit**

```bash
git add main.js && git commit -m "fix(linux): make the autostart checkbox work on Linux"
```

---

### Phase 5 verification

**Files:** none — hand-verification against the behavior built in Tasks 30-39.

- [ ] **Step 1: Full automated suite**

```bash
npm run verify
```

Expected: `all checks passed`, including the new `lib/session.js` (13 tests) and `lib/autostart.js` (6 tests) suites folded into the `node --test` total.

- [ ] **Step 2: Manual check — WM_GETMINMAXINFO resizable-flag dance on Linux**

`applyWindowPrefs()` (`main.js:260-275`) lifts `resizable` to `true` for the duration of `setSize()` when toggling compact mode, with a comment explaining this is needed on Windows because a non-resizable window pins its size through `WM_GETMINMAXINFO`. Whether X11/Wayland window managers have the same quirk is genuinely unknown without a real run — this is not something the research behind this plan could verify from source alone. On a real Linux box: toggle "Modo compacto" on and off a few times and confirm the window actually resizes both ways (356px ↔ 592px) with no leftover empty frame. If it already works without the resizable-lift, that lift is harmless there and does not need removing — leave it as shared logic.

- [ ] **Step 3: Manual check — Ozone/Wayland actually takes effect**

On a native Wayland session (`echo $WAYLAND_DISPLAY` is non-empty), launch the app and run `xlsclients -l` (X11 client-listing tool, present under XWayland). If the overlay does **not** appear in that list, it is running as a native Wayland client — correct. If it does appear, the `ozone-platform-hint` switch from Task 31 did not take effect and Electron fell back to XWayland; check the switch is actually reached before `app.whenReady()` in the built binary (not just in source).

- [ ] **Step 4: Manual check — capability matrix against reality**

On one real X11 box and one real Wayland box (any compositor), open the app's data-folder log (`Abrir pasta de dados` in the tray/settings) and confirm the `starting … sessionType compositing: …` line (Task 33) matches what the machine is actually running. This is the cheapest way to catch a `lib/session.js` detection bug that the unit tests, which only ever mock env vars, cannot catch.

---

## Phase 6: Packaging, autostart integration, release

**Goal:** Ship installable Linux artifacts — AppImage and deb — that look and behave like a real Linux app: correct icon at every size, correct taskbar/dock grouping (no generic-icon WM_CLASS mismatch), a non-blank `Maintainer:` field, Linux-accurate metadata (no "(Windows)" in the description), and a CI pipeline that builds both platforms on every version tag without disturbing the maintainer's existing local Windows `npm run dist` flow.

**Exit criteria:**
- `npm run icons` emits `build/icons/16x16.png` through `build/icons/512x512.png` alongside the existing Windows/tray assets, with zero new dependencies.
- `package.json`'s `build` config produces a correctly named (`steam-spec-overlay`), correctly categorized (`Utility`), correctly branded (matching `StartupWMClass`/`executableName`/autostart `Icon=`) AppImage and deb via `electron-builder --linux AppImage deb`.
- `.github/workflows/release.yml` builds Windows and Linux artifacts on a `v*` tag push and drafts a GitHub Release with both.
- README documents Linux install (including the FUSE2 caveat), the Linux limitations table from Phase 5, the Flatpak/Snap Steam caveat, and how to produce the Linux artifacts from the maintainer's Windows machine.
- A real tag push produces a release whose artifacts pass the Phase 6 verification hand-checks below.

---

### Task 40: Emit the Linux icon set

`scripts/make-icon.js` already renders every size an icon set needs — `for (const s of new Set([...icoSizes, 512])) rendered.set(s, render(s));` covers 16/24/32/48/64/128/256/512 — but only ever writes three of those renders to disk (`build/icon.ico`, `assets/icon.png`, `assets/tray.png`). The 512px raster is computed and thrown away. `electron-builder`'s `icon: "build/icons"` convention for the linux target wants exactly this: a directory of `<size>x<size>.png` files. Zero new dependencies — this is a loop over the file's own existing `writeFile`/`encodePng` helpers, which already do `mkdirSync(dirname, { recursive: true })`.

**Files:**
- Modify: `scripts/make-icon.js` (header comment and `main()`)

- [ ] **Step 1: Implement**

```js
// old (scripts/make-icon.js:1-12)
'use strict';
// Generates the app icon from code — no binary asset checked in, no image
// library, no design tool. Node's zlib is enough for PNG; the .ico is written
// with classic BMP entries so it works with NSIS and every Windows shell.
//
//   node scripts/make-icon.js
//     -> build/icon.ico    (installer + exe, sizes 16..256)
//     -> assets/icon.png   (window icon, 256)
//     -> assets/tray.png   (tray, 32)
//
// The artwork is the same gauge the overlay draws: a dark rounded tile with a
// red->amber->green arc and a needle sitting in the "runs fine" band.
```

```js
// new
'use strict';
// Generates the app icon from code — no binary asset checked in, no image
// library, no design tool. Node's zlib is enough for PNG; the .ico is written
// with classic BMP entries so it works with NSIS and every Windows shell.
//
//   node scripts/make-icon.js
//     -> build/icon.ico       (Windows installer + exe, sizes 16..256)
//     -> assets/icon.png      (window icon, 256)
//     -> assets/tray.png      (tray, 32)
//     -> build/icons/*.png    (Linux AppImage/deb icon set, 16..512 — one
//                              file per size, electron-builder's `icon:
//                              "build/icons"` convention for the linux target)
//
// The artwork is the same gauge the overlay draws: a dark rounded tile with a
// red->amber->green arc and a needle sitting in the "runs fine" band.
```

```js
// old (scripts/make-icon.js:266-277)
function main() {
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const rendered = new Map();
  for (const s of new Set([...icoSizes, 512])) rendered.set(s, render(s));

  writeFile(
    'build/icon.ico',
    encodeIco(icoSizes.map((size) => ({ size, data: bmpEntry(size, rendered.get(size)) })))
  );
  writeFile('assets/icon.png', encodePng(256, rendered.get(256)));
  writeFile('assets/tray.png', encodePng(32, rendered.get(32)));
}
```

```js
// new
function main() {
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const linuxSizes = [16, 24, 32, 48, 64, 128, 256, 512];
  const rendered = new Map();
  for (const s of new Set([...icoSizes, ...linuxSizes])) rendered.set(s, render(s));

  writeFile(
    'build/icon.ico',
    encodeIco(icoSizes.map((size) => ({ size, data: bmpEntry(size, rendered.get(size)) })))
  );
  writeFile('assets/icon.png', encodePng(256, rendered.get(256)));
  writeFile('assets/tray.png', encodePng(32, rendered.get(32)));
  // electron-builder's `icon: "build/icons"` (linux target) wants a directory
  // of <size>x<size>.png files instead of a single .ico/.icns container —
  // the same 512px raster already rendered above, just written per-size.
  for (const size of linuxSizes) {
    writeFile(`build/icons/${size}x${size}.png`, encodePng(size, rendered.get(size)));
  }
}
```

- [ ] **Step 2: Verify**

```bash
node scripts/make-icon.js
```

Expected: 11 lines of `<path>  <N.N> KB` output — the existing 3 (`build/icon.ico`, `assets/icon.png`, `assets/tray.png`) plus 8 new `build/icons/16x16.png` through `build/icons/512x512.png` lines. Exact KB values vary; what matters is 11 total lines, 8 of them under `build/icons/`.

```bash
node -e "const fs=require('fs');const b=fs.readFileSync('build/icons/512x512.png');const w1=b.readUInt32BE(16);const h1=b.readUInt32BE(20);const b2=fs.readFileSync('build/icons/16x16.png');const w2=b2.readUInt32BE(16);const h2=b2.readUInt32BE(20);console.log(w1,h1,w2,h2);if(w1!==512||h1!==512||w2!==16||h2!==16)throw new Error('size mismatch');console.log('ok: PNG IHDR dimensions match filenames');"
```

Expected: prints `512 512 16 16` then `ok: PNG IHDR dimensions match filenames` (PNG's IHDR chunk holds big-endian width at byte offset 16 and height at offset 20, right after the 8-byte signature + 4-byte length + 4-byte "IHDR" tag).

```bash
node scripts/selfcheck.js
```

Expected: ends with `all checks passed` (the existing "icons are present and non-trivial" check still passes since it only looks at the three pre-existing files).

- [ ] **Step 3: Commit**

```bash
git add scripts/make-icon.js build/icons/ && git commit -m "feat(build): emit the Linux icon set from make-icon.js"
```

---

### Task 41: Configure electron-builder for AppImage and deb

Several defaults in electron-builder 25.1.8 are wrong for this app, verified against the pinned tag's own source (`linuxOptions.ts`, `LinuxTargetHelper.ts`):

- `StartupWMClass` defaults to `productName` ("Steam Spec Overlay"), but Electron's runtime X11 `WM_CLASS` is derived from the **executable name** — a known electron-builder mismatch (electron-userland/electron-builder#4974) that produces a generic fallback icon and broken taskbar grouping/pinning. The fix is setting `executableName` and pointing `linux.desktop.StartupWMClass` at that same string — confirmed against the pinned tag's source that `executableName` is defined on the shared `PlatformSpecificBuildOptions` base both `win` and `linux` extend, so it can be scoped to `linux.executableName` alone without touching the Windows build's existing `.exe` naming.
- Without `executableName`, electron-builder falls back to `sanitizeFileName(productName)`, which does not strip spaces — a binary literally named `Steam Spec Overlay`.
- `maintainer`/`vendor` default to `package.json`'s `author`, which is an empty string in this repo — a deb built today ships a blank `Maintainer:` field.
- The root `description` ends in `"(Windows)"` and becomes both the `.desktop` `Comment=` and the deb `Description:` — a real user-visible bug on Linux.
- `deb.depends` defaults to `["gconf2","gconf-service","libnotify4","libappindicator1","libxtst6","libnss3"]`. `gconf*` are obsolete and `libappindicator1` no longer exists in Ubuntu 24.04+, so the stock deb fails to install there.
- `desktopName`/`syncDesktopName` and `mimeTypes` are deliberately **not** set: the first pair doesn't exist until electron-builder v26+ (silently ignored on 25.1.8), and this app registers no file types or protocols. `artifactName` is also deliberately left at its default — AppImage/deb already use their ecosystem's correct arch naming, and `${arch}` substitution has known AppImage bugs (electron-userland/electron-builder#3510).

**Target choice:** AppImage primary, deb secondary.

> **Why:** the app needs to write into the user's Steam directory and reach `127.0.0.1:8080-8090` with zero sandbox friction — both AppImage and deb do that out of the box. Flatpak's default `finishArgs` technically works but needs `--filesystem=home` (Flathub pushes back on that; the honest scoped ask is `--filesystem=~/.steam:create` etc., doubled if Steam itself is a Flatpak) and electron-builder 25.1.8 hardcodes a long-EOL `baseVersion: 20.08`. Snap's `home` interface excludes dotfiles outright, so `~/.steam` would be invisible without the super-privileged, manually-reviewed `personal-files` interface. Flatpak and Snap are deferred rather than built today; rpm is close to free on `ubuntu-latest` (which ships `rpm` already) and worth adding later as a third artifact, but isn't a commitment of this plan.

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Implement**

```json
{
  "name": "steam-spec-overlay",
  "version": "1.1.1",
  "description": "Overlay desktop que detecta o jogo aberto no app da Steam e mostra compatibilidade com o PC em tempo real.",
  "main": "main.js",
  "author": "Luan Caldeira <luanmcaldeira@gmail.com>",
  "license": "MIT",
  "scripts": {
    "start": "electron .",
    "test": "node --test",
    "icons": "node scripts/make-icon.js",
    "selfcheck": "node scripts/selfcheck.js",
    "verify": "node scripts/validate-tables.js && node scripts/selfcheck.js && node --test",
    "predist": "node scripts/make-icon.js",
    "dist": "electron-builder --win nsis portable",
    "predist:linux": "node scripts/make-icon.js",
    "dist:linux": "electron-builder --linux AppImage deb",
    "pack": "electron-builder --dir",
    "pack:linux": "electron-builder --linux --dir"
  },
  "dependencies": {
    "cheerio": "^1.0.0",
    "systeminformation": "^5.23.5"
  },
  "devDependencies": {
    "electron": "^32.0.0",
    "electron-builder": "^25.0.5"
  },
  "build": {
    "appId": "com.steamoverlay.speccheck",
    "productName": "Steam Spec Overlay",
    "files": [
      "main.js",
      "preload.js",
      "index.html",
      "styles.css",
      "renderer.js",
      "lib/**/*",
      "data/**/*",
      "assets/**/*"
    ],
    "win": {
      "icon": "build/icon.ico",
      "target": [
        { "target": "nsis", "arch": ["x64"] },
        { "target": "portable", "arch": ["x64"] }
      ]
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "perMachine": false,
      "shortcutName": "Steam Spec Overlay",
      "installerIcon": "build/icon.ico",
      "uninstallerIcon": "build/icon.ico"
    },
    "linux": {
      "icon": "build/icons",
      "category": "Utility",
      "executableName": "steam-spec-overlay",
      "desktop": {
        "StartupWMClass": "steam-spec-overlay"
      },
      "target": [
        { "target": "AppImage", "arch": ["x64"] },
        { "target": "deb", "arch": ["x64"] }
      ]
    },
    "deb": {
      "depends": [
        "libnotify4",
        "libxtst6",
        "libnss3",
        "libayatana-appindicator3-1 | libappindicator3-1"
      ]
    }
  }
}
```

- [ ] **Step 2: Verify**

```bash
node -e "const pkg=require('./package.json');console.log(JSON.stringify(pkg.build.linux))"
```

Expected: prints a valid JSON object (confirms `package.json` still parses).

```bash
node -e "const pkg=require('./package.json');const b=pkg.build;const checks=[[typeof pkg.author==='string'&&pkg.author.length>0,'author set'],[!pkg.description.includes('(Windows)'),'description Windows-free'],[b.linux&&b.linux.executableName==='steam-spec-overlay','executableName set'],[b.linux&&b.linux.desktop&&b.linux.desktop.StartupWMClass===b.linux.executableName,'StartupWMClass matches executableName'],[b.linux&&b.linux.category==='Utility','category set'],[b.linux&&b.linux.icon==='build/icons','icon dir set'],[!('desktopName' in (b.linux||{})),'no desktopName'],[!('mimeTypes' in (b.linux||{})),'no mimeTypes'],[!('artifactName' in (b.linux||{})),'no artifactName override'],[Array.isArray(b.deb&&b.deb.depends)&&b.deb.depends.some(d=>d.includes('libayatana-appindicator3-1')),'deb depends overridden'],[Array.isArray(b.linux.target)&&b.linux.target.some(t=>t.target==='AppImage')&&b.linux.target.some(t=>t.target==='deb'),'AppImage+deb targets']];const failed=checks.filter(c=>!c[0]);console.log(failed.length?'FAIL: '+failed.map(c=>c[1]).join(', '):'ok: all '+checks.length+' packaging checks passed');"
```

Expected: `ok: all 11 packaging checks passed`

```bash
npm run verify
```

Expected: ends with `all checks passed` (selfcheck's "packaged files all exist" check reads `build.files`, which is unchanged, so this stays green).

If run from a real Linux machine or the Docker/WSL2 setup from the README (Task 43), also confirm an unpacked build looks right:

```bash
npm run pack:linux
```

Expected: `dist/linux-unpacked/steam-spec-overlay` exists as the binary name (not `Steam Spec Overlay`).

- [ ] **Step 3: Commit**

```bash
git add package.json && git commit -m "build(linux): add AppImage and deb packaging config"
```

---

### Task 42: Add the cross-platform release workflow

No `.github/` directory exists yet. This workflow builds Windows (`nsis`, `portable`) and Linux (`AppImage`, `deb`) on every `v*` tag push and drafts a GitHub Release with both sets of artifacts.

A Windows host cannot build AppImage, deb, or rpm — `dpkg-deb`/`fakeroot`/`rpmbuild` don't exist there, and AppImage additionally fails on `chmod`/`mksquashfs` (electron-userland/electron-builder#3413, #4318). `ubuntu-latest` is what makes the Linux leg of this workflow possible at all; the README (Task 43) covers the Docker/WSL2 alternative for building Linux artifacts locally from the maintainer's Windows machine.

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Implement**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - name: Checkout
        uses: actions/checkout@v7

      - name: Set up Node.js
        uses: actions/setup-node@v7
        with:
          node-version: 24

      - name: Ensure Linux packaging tools are present
        if: matrix.os == 'ubuntu-latest'
        # dpkg, fakeroot and rpm already ship on ubuntu-latest (24.04) as of
        # this writing, so this is normally a fast no-op — kept as a
        # defensive pin in case a future runner image drops one of them. The
        # common "apt-get install rpm fakeroot" advice for electron-builder
        # is otherwise stale on this runner.
        run: sudo apt-get update && sudo apt-get install -y --no-install-recommends dpkg fakeroot rpm

      - name: Install dependencies
        run: npm ci

      - name: Verify
        run: npm run verify

      - name: Generate icons
        run: npm run icons

      - name: Build (Windows)
        if: matrix.os == 'windows-latest'
        run: npx electron-builder --win nsis portable

      - name: Build (Linux)
        if: matrix.os == 'ubuntu-latest'
        run: npx electron-builder --linux AppImage deb

      - name: Upload Windows artifacts
        if: matrix.os == 'windows-latest'
        uses: actions/upload-artifact@v7
        with:
          name: windows-build
          path: dist/*.exe
          if-no-files-found: error

      - name: Upload Linux artifacts
        if: matrix.os == 'ubuntu-latest'
        uses: actions/upload-artifact@v7
        with:
          name: linux-build
          path: |
            dist/*.AppImage
            dist/*.deb
          if-no-files-found: error

  release:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Download all artifacts
        uses: actions/download-artifact@v8
        with:
          path: dist-artifacts

      - name: Draft GitHub release
        uses: softprops/action-gh-release@v3
        with:
          draft: true
          files: |
            dist-artifacts/**/*.exe
            dist-artifacts/**/*.AppImage
            dist-artifacts/**/*.deb
```

Note: the build steps call `npx electron-builder` directly rather than `npm run dist` / `npm run dist:linux` — those scripts' `predist`/`predist:linux` hooks would regenerate icons a second time, redundant with the explicit "Generate icons" step above. `npm run dist`/`dist:linux` stay untouched for the maintainer's local muscle memory; CI just doesn't route through them.

- [ ] **Step 2: Verify**

```bash
node -e "const s=require('fs').readFileSync('.github/workflows/release.yml','utf8');const need=['Windows%20%7C%20Linux'.slice(0,0),\"- 'v*'\",'actions/checkout@v7','actions/setup-node@v7','node-version: 24','actions/upload-artifact@v7','actions/download-artifact@v8','softprops/action-gh-release@v3','contents: write','windows-latest','ubuntu-latest','--win nsis portable','--linux AppImage deb'].filter(Boolean);const missing=need.filter(n=>!s.includes(n));console.log(missing.length?'MISSING: '+missing.join(', '):'ok: all structural checks passed');"
```

Expected: `ok: all structural checks passed`

This confirms every required piece of text is present but, being a plain-text scan, cannot catch a YAML indentation mistake — that gets its real proof at the actual tag push in the Phase 6 verification section below.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml && git commit -m "ci(build): add cross-platform release workflow"
```

---

### Task 43: Document Linux support in the README

**Files:**
- Modify: `README.md` (lines 9, 28-29, 79-88, 94-101, 137-138, 154, 194, plus new content)

- [ ] **Step 1: Platform badge**

```md
<!-- old (README.md:9) -->
[![plataforma](https://img.shields.io/badge/plataforma-Windows-0078D4)](#)
```

```md
<!-- new -->
[![plataforma](https://img.shields.io/badge/plataforma-Windows%20%7C%20Linux-0078D4)](#)
```

- [ ] **Step 2: Warning callout**

```md
<!-- old (README.md:28-29) -->
> ⚠️ **Só Windows + app desktop da Steam.** Não funciona com a Steam no navegador, nem no
> macOS/Linux. E não é um overlay dentro do jogo — é sobre a janela da **loja**.
```

```md
<!-- new -->
> ⚠️ **Windows ou Linux (X11/Wayland) + app desktop da Steam.** Não funciona com a Steam no
> navegador, nem no macOS. E não é um overlay dentro do jogo — é sobre a janela da **loja**.
```

- [ ] **Step 3: Instalação — split Windows/Linux, add build scripts, add the cross-build subsection**

```md
<!-- old (README.md:68-88) -->
## Instalação

**Usuário final** — baixe em [Releases](../../releases/latest):

- `Steam Spec Overlay Setup 1.1.0.exe` — instalador (cria atalho, permite escolher a pasta)
- `Steam Spec Overlay 1.1.0.exe` — versão portable, roda sem instalar

> O executável não é assinado (certificado de code signing é pago), então o Windows pode
> mostrar um aviso do SmartScreen na primeira execução. **Mais informações → Executar
> assim mesmo.**

**Desenvolvimento:**

```bash
npm install
npm start          # roda o overlay
npm run verify     # tabelas + self-check + 106 testes
npm run dist       # gera instalador NSIS + portable em dist/
```

Requer Node.js 18+ (testado no Node 24) e Windows.
```

```md
<!-- new -->
## Instalação

**Usuário final** — baixe em [Releases](../../releases/latest):

**Windows:**
- `Steam Spec Overlay Setup 1.1.0.exe` — instalador (cria atalho, permite escolher a pasta)
- `Steam Spec Overlay 1.1.0.exe` — versão portable, roda sem instalar

> O executável não é assinado (certificado de code signing é pago), então o Windows pode
> mostrar um aviso do SmartScreen na primeira execução. **Mais informações → Executar
> assim mesmo.**

**Linux:**
- `Steam-Spec-Overlay-1.1.1.AppImage` — roda em qualquer distro, sem instalar:
  ```bash
  chmod +x Steam-Spec-Overlay-*.AppImage
  ./Steam-Spec-Overlay-*.AppImage
  ```
  A integração com o menu de aplicativos é opcional por design — o AppImage roda direto sem
  ela. Para criar um atalho no menu, use um integrador como o
  [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) ou a opção "Integrar e
  executar" do seu gerenciador de arquivos, se ele tiver uma.

  > Requer `libfuse2`. O Ubuntu parou de instalar isso por padrão a partir da 22.04; na 24.04
  > o pacote foi renomeado para `libfuse2t64` (transição para time_t de 64 bits). Instale com
  > `sudo apt install libfuse2t64` (24.04+) ou `sudo apt install libfuse2` (22.04). Sem FUSE,
  > rode com `./Steam-Spec-Overlay-*.AppImage --appimage-extract-and-run`.
- `steam-spec-overlay_1.1.1_amd64.deb` — para Debian/Ubuntu e derivados:
  ```bash
  sudo apt install ./steam-spec-overlay_1.1.1_amd64.deb
  ```

> A própria Steam também precisa estar instalada — nativa (`.deb`/`.rpm`) ou como Flatpak. O
> overlay tenta os caminhos usuais de cada formato, mas Flatpak e Snap são suportados na base
> do possível, sem garantia formal para toda variação de sandboxing.

**Desenvolvimento:**

```bash
npm install
npm start          # roda o overlay
npm run verify     # tabelas + self-check + 106 testes
npm run dist       # Windows: gera instalador NSIS + portable em dist/
npm run dist:linux # Linux: gera AppImage + deb em dist/ (só funciona rodando em Linux)
```

Requer Node.js 18+ (testado no Node 24). Roda em Windows e Linux (X11 ou Wayland — veja
[Limitações no Linux](#limitações-no-linux) para o que muda por ambiente).

### Gerando os pacotes Linux a partir do Windows

`electron-builder` não consegue empacotar AppImage/deb/rpm rodando no Windows —
`dpkg-deb`, `fakeroot` e `mksquashfs` não existem por lá. As opções:

- **GitHub Actions** (recomendado) — o workflow em
  [`.github/workflows/release.yml`](.github/workflows/release.yml) já faz isso a cada tag
  `v*`.
- **Docker**, a partir da raiz do projeto:
  ```bash
  docker run --rm -ti \
    -v ${PWD}:/project \
    -v ~/.cache/electron:/root/.cache/electron \
    -v ~/.cache/electron-builder:/root/.cache/electron-builder \
    electronuserland/builder:24 \
    /bin/bash -c "npm ci && npm run icons && npm run dist:linux"
  ```
- **WSL2**, com o repositório clonado dentro do filesystem do Linux (algo como
  `~/steam-spec-overlay`, **não** `/mnt/c/...` — I/O em `/mnt/c` é lento o bastante pra
  atrapalhar o `npm install`).

O problema de symlink do `winCodeSign` que trava `npm run dist` numa máquina Windows sem o
Modo de Desenvolvedor ligado **não** se aplica aqui: `winCodeSign` só é baixado para alvos
`--win`, e tanto o Docker quanto o WSL2 rodam um filesystem Linux de verdade, onde a
restrição do Windows (`SeCreateSymbolicLinkPrivilege`) simplesmente não existe.
```

- [ ] **Step 4: CEF debug flag paths**

```md
<!-- old (README.md:94-101) -->
A Steam só abre a porta de debug se existir um arquivo vazio chamado
`.cef-enable-remote-debugging` na raiz da pasta de instalação dela
(ex.: `C:\Program Files (x86)\Steam\.cef-enable-remote-debugging`).

**O app faz isso pra você:**

1. Abra o overlay. Sem detecção ativa, ele mostra o botão **"Ativar debug"** — clique. Ele
   acha a pasta da Steam pelo registro do Windows e cria o arquivo.
```

```md
<!-- new -->
A Steam só abre a porta de debug se existir um arquivo vazio chamado
`.cef-enable-remote-debugging` na raiz da pasta de instalação dela — no Windows, por exemplo
`C:\Program Files (x86)\Steam\.cef-enable-remote-debugging`; no Linux, tipicamente
`~/.steam/steam/.cef-enable-remote-debugging` (ou
`~/.var/app/com.valvesoftware.Steam/.steam/steam/...` se a própria Steam for um Flatpak).

**O app faz isso pra você:**

1. Abra o overlay. Sem detecção ativa, ele mostra o botão **"Ativar debug"** — clique. Ele
   acha a pasta da Steam (pelo registro do Windows, ou pelos caminhos padrão no Linux) e cria
   o arquivo.
```

- [ ] **Step 5: Tray bullet — autostart wording + Wayland recovery note**

```md
<!-- old (README.md:137-138) -->
- **Ícone na bandeja** com mostrar/esconder, sempre-no-topo, click-through, iniciar com o
  Windows e sair. É também a rota de recuperação se nenhum atalho global estiver livre.
```

```md
<!-- new -->
- **Ícone na bandeja** com mostrar/esconder, sempre-no-topo, click-through, iniciar com o
  sistema e sair. É também a rota de recuperação se nenhum atalho global estiver livre — no
  GNOME/Wayland sem a extensão de bandeja instalada, use `Ctrl+Alt+C` ou simplesmente reabra
  o app: a instância é única e a janela volta pra frente sozinha.
```

- [ ] **Step 6: Data folder path**

```md
<!-- old (README.md:154) -->
Configurações, cache e log ficam em `%APPDATA%\steam-spec-overlay\` — o botão **Abrir
pasta de dados** leva direto lá.
```

```md
<!-- new -->
Configurações, cache e log ficam em `%APPDATA%\steam-spec-overlay\` no Windows ou em
`~/.config/steam-spec-overlay/` no Linux — o botão **Abrir pasta de dados** leva direto lá.
```

- [ ] **Step 7: DirectX limitation bullet**

```md
<!-- old (README.md:194-195) -->
- O selo de **DirectX** reflete o que o seu Windows expõe; o nível real também depende do
  *feature level* da GPU. Por isso é informativo e fica fora do cálculo.
```

```md
<!-- new -->
- O selo de **DirectX** reflete o que o Windows expõe (inclusive rodando via Proton no
  Linux); o nível real também depende do *feature level* da GPU, por isso é informativo e
  fica fora do cálculo. Em Linux nativo, sem Windows por baixo, esse selo simplesmente não
  aparece.
```

- [ ] **Step 8: New "Limitações no Linux" subsection**

Insert immediately after the existing last bullet of `## Limitações` (the "requisitos indisponíveis" one), before the `---` separator that leads into `## Qualidade`:

```md
### Limitações no Linux

| Ambiente | Transparência | Sempre no topo | Click-through | Atalho global | Posição salva | Bandeja |
|---|---|---|---|---|---|---|
| X11 (com compositor) | Sim | Sim | Sim | Sim | Sim | Sim |
| X11 (sem compositor) | **Não** — fundo preto sólido | Sim | Sim | Sim | Sim | Sim |
| Wayland · KDE (KWin) | Sim | Sim | Sim, com 30-290ms de latência | **Não** | **Não** | Sim (nativo) |
| Wayland · GNOME (Mutter) | Sim | **Não** | Não confiável | **Não** | **Não** | Só com extensão |
| Wayland · outros (Sway, Hyprland…) | Não verificado | Não verificado | Não verificado | **Não** | **Não** | Não verificado |

- **Sem compositor no X11** não é detectado automaticamente — exigiria um binding nativo
  fora do escopo deste app. Se a janela renderizar com fundo preto sólido em vez de
  transparente, ligue **Desativar transparência** nas configurações; o app aplica isso no
  próximo início.
- **Atalho global não funciona em nenhum Wayland hoje** — é uma limitação do próprio
  Electron (o handshake `xdg-desktop-portal` para registrar atalhos globais não está
  implementado). Sem atalho e sem bandeja confiável, o app **recusa ligar o click-through**
  para nunca deixar a janela travada; use o ícone da bandeja, ou reabra o app.
- **Posição da janela não é salva no Wayland** — o protocolo não deixa um cliente perguntar
  nem definir sua própria posição na tela; o overlay sempre abre no canto padrão.
- **Bandeja no GNOME/Wayland** precisa da extensão "AppIndicator and KStatusNotifierItem
  Support", instalada à parte pelo usuário — sem ela, o overlay não sabe se a bandeja existe.
- **Steam Deck, modo Jogo:** fora de escopo. O gamescope do Deck expõe só um slot de overlay
  (`GAMESCOPE_EXTERNAL_OVERLAY`), permanentemente ocupado pelo `mangoapp` mesmo quando
  escondido, e não implementa `xdg-desktop-portal`. **Modo Desktop funciona normalmente** —
  é KDE Plasma Wayland, mesma linha da tabela acima.
```

- [ ] **Step 9: Estrutura tree — new lib files**

```md
<!-- old, inside the ```
    windowFallback.js     plano B via título de janela (tasklist)
    settings.js            preferências persistentes e validadas
``` block -->
    windowFallback.js     plano B via título de janela (tasklist)
    settings.js            preferências persistentes e validadas
```

```md
<!-- new -->
    windowFallback.js     plano B via título de janela (tasklist)
    session.js             detecta X11/Wayland, compositor e o que cada capacidade suporta
    autostart.js           entrada XDG autostart (~/.config/autostart) no Linux
    settings.js            preferências persistentes e validadas
```

- [ ] **Step 10: Verify**

```bash
node -e "const s=require('fs').readFileSync('README.md','utf8');const need=['Windows%20%7C%20Linux','chmod +x','libfuse2','appimage-extract-and-run','dist:linux','Limitações no Linux','AppImageLauncher','GAMESCOPE_EXTERNAL_OVERLAY'];const bad=['plataforma-Windows-0078D4'];const missing=need.filter(n=>!s.includes(n));const stale=bad.filter(n=>s.includes(n));console.log(missing.length?'MISSING: '+missing.join(', '):'all new content present');console.log(stale.length?'STALE STILL PRESENT: '+stale.join(', '):'stale badge removed');"
```

Expected:
```
all new content present
stale badge removed
```

- [ ] **Step 11: Commit**

```bash
git add README.md && git commit -m "docs: document Linux install, limitations and cross-build"
```

---

### Phase 6 verification

**Files:** none — hand-verification of a real tagged release.

- [ ] **Step 1: Cut a release**

```bash
git checkout main
git pull
npm version 1.2.0 -m "chore(release): v%s"
git push origin main --follow-tags
```

`npm version <newversion>` bumps `package.json`, commits it, and creates the annotated tag `v1.2.0` (npm's default `v` prefix). `--follow-tags` pushes the commit and the tag together, which is what fires `.github/workflows/release.yml`'s `push: tags: - 'v*'` trigger.

- [ ] **Step 2: Confirm the artifacts**

On the Actions run: two `build` matrix legs (`windows-latest`, `ubuntu-latest`) both green, followed by a `release` job. On the resulting draft GitHub Release, expect:
- `Steam Spec Overlay Setup 1.2.0.exe` (installer)
- `Steam Spec Overlay 1.2.0.exe` (portable)
- an `.AppImage` file (name includes the version and `x86_64`)
- `steam-spec-overlay_1.2.0_amd64.deb`

- [ ] **Step 3: Hand-check — X11 with a compositor** (GNOME/KDE/XFCE/Cinnamon on X11)

- [ ] AppImage launches; window is transparent, rounded corners visible, no solid-black box.
- [ ] Always-on-top holds when another window is focused.
- [ ] Click-through checkbox works; `Ctrl+Alt+C` recovers it.
- [ ] Global shortcut `Ctrl+Shift+S` shows/hides.
- [ ] Window position survives a restart.
- [ ] Tray icon appears and its menu works.
- [ ] Settings panel shows no Linux-limitation warnings.

- [ ] **Step 4: Hand-check — GNOME Wayland** (Ubuntu/Fedora Workstation default session)

- [ ] Data-folder log shows `sessionType wayland` and `desktop` containing `GNOME`.
- [ ] "Sempre no topo" checkbox is visibly greyed out with an explanation in the settings hint.
- [ ] Without the AppIndicator GNOME Shell extension installed: attempting to enable click-through is refused (checkbox stays off, or is itself disabled) rather than silently trapping the window.
- [ ] After installing "AppIndicator and KStatusNotifierItem Support": the tray icon appears, and click-through becomes available.
- [ ] Global shortcut does not register; the hint explains it instead of claiming a combo is active.
- [ ] Window position is **not** persisted across restarts.

- [ ] **Step 5: Hand-check — KDE Plasma Wayland**

- [ ] Always-on-top works.
- [ ] Click-through works; the 30-290ms input latency is noticeable but tolerable (documented UX footnote, not a bug to chase).
- [ ] Global shortcut still does not register (same Electron-wide portal limitation as GNOME); tray recovery works.
- [ ] Tray icon appears natively, no extension needed.
- [ ] Window position not persisted (Wayland-wide, same as GNOME).

- [ ] **Step 6: Hand-check — Steam Deck, Desktop Mode**

- [ ] Desktop Mode is KDE Plasma Wayland — the Step 5 checklist applies as-is.
- [ ] AppImage runs directly from wherever it's placed (e.g. `~/Applications`); no special SteamOS packaging is needed for Desktop Mode.

- [ ] **Step 7: Steam Deck, Game Mode — explicitly out of scope, do not test**

gamescope (SteamOS's Game Mode compositor) exposes exactly one `GAMESCOPE_EXTERNAL_OVERLAY` slot, and `mangoapp` (the performance HUD) holds it permanently even while hidden — there is no second slot for this app to claim. Electron's own attempt at gamescope overlay support (electron/electron#45387) was closed unmerged. gamescope also implements no `xdg-desktop-portal`, so even the already-broken Wayland portal paths this app depends on have nothing to talk to in Game Mode. None of this is fixable from the app side without upstream Electron/gamescope work first.
