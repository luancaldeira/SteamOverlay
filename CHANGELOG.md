# Changelog

🌐 **English** · [Português](CHANGELOG.pt-BR.md)

## 1.2.0

Documentation-only release. No changes to detection, comparison, or the app itself.

- **English is now the primary language** for the README and this changelog.
  Portuguese versions are kept in sync as `README.pt-BR.md` and
  `CHANGELOG.pt-BR.md`, linked from the top of each file.
- **Linux support plan added**:
  [`docs/LINUX-SUPPORT-PLAN.md`](docs/LINUX-SUPPORT-PLAN.md), a 7-phase,
  task-by-task implementation plan — Steam discovery, hardware detection,
  Proton/ProtonDB integration, per-window-manager degradation, and
  AppImage/deb packaging with CI. Nothing in the plan is implemented yet; the
  app is still Windows-only.

## 1.1.1

Four targeted fixes on top of 1.1.0, found in code review and confirmed with
new automated tests.

- **A CDP blip rebuilt the whole interface.** The game was keyed on
  `${source}:${appid}`; when CEF debugging dropped for an instant and
  reconnected, the same game was reported twice with a different `source`
  (`fallback` → `cdp`), and every source change triggered a full reload —
  "loading requirements…", artwork wiped, entrance animation replayed. The
  game is now keyed on `appid` alone; a source change becomes metadata, no
  refetch.
- **"Show game artwork" didn't affect the game already on screen**, only the
  next one. Turning it off left the old artwork; turning it on showed
  nothing until the next game.
- **An unidentified GPU or RAM hid a fact the app already knew.** When the
  model didn't match the table but the requirement cited VRAM or GB of RAM,
  that information — the most actionable part of the line — was dropped in
  favor of the generic reason ("requirement not recognized"). It now shows:
  "your component is outside the table · VRAM 4/8 GB ✗".
- **The "runs comfortably" (85+) and "should run well" (65-84) scores used
  the exact same color.** `--accent-fair` now reuses the hue extracted from
  the artwork, at half the saturation, with lightness recalculated against
  its own contrast floor (worst case measured: 4.71:1).

### Verification

- An integration harness that runs the real `main.js` under Electron, with
  only the network/OS modules swapped for stubs, reproducing the exact
  production sequence (CDP detects → drops → fallback takes over → CDP
  reconnects): confirms zero refetches, `loadingReq` never going back to
  `true`, and the artwork surviving the reconnect.
- `npm run verify`: 106/106.

## 1.1.0

Complete interface redesign. The detection and comparison logic (`lib/`) was
untouched — the scores are the same.

### Game artwork now drives the palette

- **Color extracted from the banner.** The renderer samples the store
  artwork, pulls the dominant hue, and applies it as the accent across the
  whole interface: the number, the ruler, the bars, the active toggle, the
  title-bar mark. Cyberpunk turns yellow, Elden Ring gold, Stardew blue. No
  two screenshots look alike.
- Accent lightness is **derived per hue**, not fixed. HSL isn't perceptually
  uniform: at the same L=62%, yellow gives 12:1 contrast against the
  background and pure blue gives 3.31:1 — it would fail. A binary search
  finds the minimum that hits 4.6:1 and only rises when the hue demands it,
  so yellow stays vibrant and blue climbs to ~70%.
- Hues in the alarm-red range are steered away, otherwise a "92 · runs
  comfortably" would come out the same color as "below requirement".
- With no artwork, the accent falls back to Steam's own action green.

### An instrument instead of a dashboard

- **The speedometer is gone.** In its place, a tolerance ruler with the
  requirement marked at 70 — the point where `scoreFromRatio` considers the
  requirement met exactly. Takes up 34px instead of 120px and says more.
- **Vertical meters** for GPU, CPU and RAM, side by side under a single
  requirement line. You can tell at a glance which component is the
  bottleneck.
- **Comparison under the pointer.** Each component's detail appears in a
  single line, on hover (or keyboard focus) over the column. With no
  pointer, it shows the bottleneck. Before, three fixed lines took up the
  screen.
- Game artwork in full color, bleeding under the title bar.
- Custom typography: Archivo (variable-width axis, so a long game name fits
  in 360px) and Martian Mono for data only.
- Choreographed entrance sequence on game switch.
- The idle screen shows the machine's spec sheet instead of a line of text.

### Fixes

- **Closing settings left the window blank**, with no self-recovery while
  the same game stayed open.
- **The score counter jumped backwards** on game switch: the displayed
  value was only saved at the end of the animation, so an interrupted
  animation started from the wrong number.
- **Artwork arriving after the requirements pushed the layout down 98px**,
  shoving the chips out of the window. The space is now reserved from the
  start.
- Sections marked hidden kept being painted: author rules were winning
  over the browser stylesheet's `[hidden]`.
- Color extraction could hang forever on a null canvas context.
- An unavailable score showed the needle at zero, visually identical to
  "below requirement", contradicting the text next to it.
- `backdrop-filter` was inert on a transparent window on Windows: it cost
  GPU and drew nothing.

### Accessibility

- Fixed contrast: the secondary gray failed at 3.66:1, now 5.12:1.
- The five settings switches were invisible to the keyboard.
- Visible focus, themed text selection and scrollbar.
- Title-bar icons drawn in SVG, instead of system glyphs.

## 1.0.1

### Fixes

- **Click-through lockout, no way out.** `Ctrl+Alt+S` (and its fallbacks)
  only hid/showed the window — nothing turned click-through off. With it
  on, the window ignores every click, including the very checkbox that
  would turn it off and the settings button needed to reach it. New global
  shortcut **`Ctrl+Alt+C`** (fallbacks `Ctrl+Shift+C`, `Ctrl+Shift+F11`)
  always turns click-through off and brings the window to the front —
  a recovery action, not a toggle, so it can't lock again.

## 1.0.0

Rewrite of the accuracy core, the network path, and the product layer.

### Accuracy

- **The official `appdetails` API as the primary source** for
  requirements, with store-page scraping demoted to a fallback. A ~5 KB
  JSON instead of ~500 KB of HTML, and it comes with the canonical name and
  the game's artwork thrown in.
- **"Or" semantics**: a requirement with alternatives ("GTX 1060 or RX 580
  or Arc A380") now uses the **weakest** one. Before, whichever model name
  was longest won, which could inflate the requirement.
- **Exclusion clauses dropped**: "RX 580 (Intel UHD 630 not supported)" no
  longer lets the UHD 630 become the bar.
- **Estimation by family** for models outside the table: interpolation
  between neighbors in the same family and generation, flagged with `≈` /
  the `ESTIMADO` badge. Before, the component was simply discarded.
- **VRAM gate**: a faster card with less VRAM than the game asks for has
  its score capped by that.
- **Sanitized device names** — `(R)`, `(TM)`, "Advanced Micro Devices,
  Inc." and friends used to stop the name from matching the table.
- **Expanded benchmark tables**: GPU from 103 → 349 entries, CPU from 135
  → 388. Includes RTX 50, RX 9000, Arc B, Core Ultra, Ryzen 9000/X3D,
  laptop parts, APUs, and the 2007–2012 generation that still shows up in
  the minimum requirements of older games (Dota 2, CS). No pre-existing
  value was changed.
- **Squashed model names** (`GTX1060`, `HD2600`, `9600GT`, `RX6600XT`) now
  match — old store listings write them this way and none of it used to be
  recognized.
- **Extra requirements now exist**: OS, DirectX, disk space and 64-bit were
  parsed and thrown away; they now become ✓/✗ badges (kept out of the %
  weight, since they aren't a performance signal).

### Robustness and performance

- **Library detection**: `/library/app/<id>` pages from the client are now
  recognized, not just store ones.
- **Localized titles**: a pt-BR client returns "Dota 2 **no** Steam"; the
  suffix used to stay in the name. It's now stripped, and the API's name
  wins.
- **Deterministic CDP target selection**: only `type: page`, store outranks
  library, devtools and empty targets are ignored. The port that worked is
  remembered.
- **No more wasted processes**: with CDP connected, the environment loop no
  longer fires `reg query` or `tasklist` (it used to be ~40 processes a
  minute, forever). The Steam path is cached and the process check is
  throttled and deduplicated.
- **Fallback without PowerShell**: it used to compile a C# shim via
  `Add-Type` on every tick; it now reads the title column `tasklist`
  already prints, by position — immune to a localized Windows. The search
  result is also now validated against the name searched for, so it never
  confidently shows the wrong game.
- **Disk cache** for requirements, specs and artwork, with a TTL and stale
  reads: the second launch is instant and a page you've already seen works
  without internet.
- **Retry with backoff** and distinct errors (`network` / `unavailable` /
  `no-windows`).
- **Rotating file log** instead of silent `catch {}` blocks.

### Product

- **App icon**, generated in code (pure PNG + ICO in Node, no external
  asset or image library) — window, tray and installer.
- **Tray icon** with a menu: show/hide, always on top, click-through, start
  with Windows, open data folder, quit. It's the recovery route when no
  global shortcut is free.
- **Settings panel** with opacity, always on top, click-through, compact
  mode, game artwork, start with Windows, and default profile.
- **Window position remembered**, validated against monitors that
  disappeared.
- **Game header artwork** in the overlay, fetched in the main process and
  delivered as a data URL — the CSP stays locked down.
- `CACHE` badge when data came from the cache after a network failure;
  animated counter; tooltip with the raw requirement text.

### Quality

- Tests: **28 → 104**, covering "or" semantics, negation, the estimator,
  VRAM, extras, the API client (with stubbed network), settings, cache and
  `tasklist` parsing.
- `npm run verify` = table validator + self-check + tests.
- `scripts/validate-tables.js`: duplicates, matcher reachability,
  monotonicity per family/generation, and ordering anchors.
- `scripts/selfcheck.js`: an end-to-end smoke test with no network and no
  Electron, including checking that every `window.api.*` the renderer uses
  exists in the preload and has a handler in main.

### Fixes

- Settings' `x`/`y` turned into `0` on the first change to any preference
  (`Number(null)` is `0`), which would throw the overlay into the top-left
  corner.
- The 64-bit chip printed the label twice ("64 bits 64 bits").
- **Compact mode didn't shrink the window at runtime.** A `resizable:
  false` window pins its size via `WM_GETMINMAXINFO` on Windows, so
  `setSize` was silently ignored: the content vanished and the empty frame
  was left behind. The flag is now lifted only for the call.
- `loadFile` now uses an absolute path, instead of depending on the working
  directory.

## 0.1.0

Initial version.
