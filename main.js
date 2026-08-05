'use strict';
const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen,
  shell,
  Tray,
  Menu,
  nativeImage,
} = require('electron');
const path = require('path');

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

const WIN_W = 360;
const WIN_H = 600;
const WIN_H_COMPACT = 316;

let win = null;
let tray = null;
let poller = null;
let envTimer = null;
let moveTimer = null;
let tables = null;

// CDP considered "lost" only after this many consecutive failed env checks,
// so a brief blip doesn't flip the mode to fallback.
const CDP_GRACE_TICKS = 2;
let cdpConnected = false;
let cdpMissTicks = 0;

const state = {
  mode: 'starting', // starting | cdp | fallback | setup | no-steam
  cdpPort: null,
  steamRunning: false,
  steamPath: null,
  flagExists: false,
  specs: null,
  game: null, // { appid, title, source, kind }
  artwork: null, // data: URL of the store header image
  loadingReq: false,
  requirements: null, // { available, minimum, recommended }
  requirementsError: null, // 'network' | 'unavailable' | 'no-windows' | null
  comparison: null, // { minimum, recommended }
  extras: null, // { minimum: [...], recommended: [...] }
  stale: false, // requirements served from cache after a failed fetch
  shortcut: null, // active global show/hide accelerator, or null if none registered
  settings: null,
  version: app.getVersion(),
  updatedAt: 0,
};

function pushState() {
  state.updatedAt = Date.now();
  if (win && !win.isDestroyed()) win.webContents.send('state', state);
}

// ---- game handling -------------------------------------------------------
let currentKey = null; // `${source}:${appid}` to dedupe redundant work

function clearGameState() {
  currentKey = null;
  state.game = null;
  state.artwork = null;
  state.requirements = null;
  state.requirementsError = null;
  state.comparison = null;
  state.extras = null;
  state.stale = false;
  state.loadingReq = false;
}

function buildComparison(info, specs) {
  const comparison = compareLib.compare(specs, info, tables);
  const extras = {
    minimum: info.minimum ? extrasLib.buildExtras(info.minimum, specs) : [],
    recommended: info.recommended ? extrasLib.buildExtras(info.recommended, specs) : [],
  };
  return { comparison, extras };
}

async function loadArtwork(key, url) {
  if (!url || !settings.get('showArtwork')) return;
  const dataUrl = await steamApi.getArtwork(url);
  if (dataUrl && currentKey === key) {
    state.artwork = dataUrl;
    pushState();
  }
}

async function handleGame(game, source) {
  if (!game) {
    if (currentKey !== null) {
      clearGameState();
      pushState();
    }
    return;
  }
  const key = `${source}:${game.appid}`;
  if (key === currentKey) return; // already handling/handled this game (retry clears currentKey)
  currentKey = key;

  state.game = { appid: game.appid, title: game.title || null, source, kind: game.kind || null };
  state.artwork = null;
  state.loadingReq = true;
  state.requirements = null;
  state.requirementsError = null;
  state.comparison = null;
  state.extras = null;
  state.stale = false;
  pushState();

  try {
    const info = await steamApi.getGameInfo(game.appid);
    // guard against a newer game having been selected while we awaited
    if (currentKey !== key) return;
    // specs may still be detecting if a game resolved first — wait for them
    // (cached, so this is instant once detected) so compare never sees null
    if (!state.specs) state.specs = await detectSpecs();
    if (currentKey !== key) return;

    if (info.name) state.game.title = info.name;
    state.requirements = info;
    state.stale = !!info.stale;
    loadArtwork(key, info.headerImage);

    if (info.available) {
      const built = buildComparison(info, state.specs);
      state.comparison = built.comparison;
      state.extras = built.extras;
      state.requirementsError = null;
    } else {
      state.comparison = null;
      state.requirementsError = info.windows === false ? 'no-windows' : 'unavailable';
    }
  } catch (e) {
    if (currentKey !== key) return;
    log.warn('requirements lookup failed for', String(game.appid), e);
    state.requirements = null;
    state.comparison = null;
    state.requirementsError = 'network';
  } finally {
    if (currentKey === key) {
      state.loadingReq = false;
      pushState();
    }
  }
}

// ---- environment / mode loop --------------------------------------------
async function envTick() {
  try {
    if (cdpConnected) {
      // CDP owns detection and needs no process probing at all. Skipping the
      // registry + tasklist calls here is what keeps the overlay idle-cheap.
      cdpMissTicks = 0;
      if (state.mode !== 'cdp') {
        state.mode = 'cdp';
        pushState();
      }
      return;
    }
    cdpMissTicks++;

    const [running, flag] = await Promise.all([setup.isSteamRunning(), setup.debugFlagStatus()]);
    state.steamRunning = running;
    state.steamPath = flag.steamPath;
    state.flagExists = flag.flagExists;

    if (!running) {
      setNoGameMode('no-steam');
      return;
    }
    if (!flag.flagExists) {
      setNoGameMode('setup');
      return;
    }
    // flag present but CDP still down: likely Steam needs a restart. Try fallback
    // to remain useful in the meantime.
    if (cdpMissTicks >= CDP_GRACE_TICKS) {
      const guess = await fallback.getFallbackGame();
      if (cdpConnected) return; // CDP reconnected during the await; let it own detection
      if (guess) {
        state.mode = 'fallback';
        await handleGame(guess, 'fallback');
        return;
      }
      setNoGameMode('setup'); // flag there, no CDP, no fallback hit -> ask to restart Steam
    }
  } catch (e) {
    log.debug('env tick failed', e);
  }
}

function setNoGameMode(mode) {
  const changed = state.mode !== mode || state.game !== null;
  state.mode = mode;
  if (state.game !== null || currentKey !== null) clearGameState();
  if (changed) pushState();
}

// ---- window --------------------------------------------------------------
// Keep the overlay inside a display that actually exists: a saved position from
// a monitor that has since been unplugged would put it out of reach.
function resolvePosition(prefs, height) {
  const fallbackPos = () => {
    const wa = screen.getPrimaryDisplay().workArea;
    return { x: wa.x + wa.width - WIN_W - 24, y: wa.y + 24 };
  };
  if (prefs.x == null || prefs.y == null) return fallbackPos();
  const display = screen.getDisplayNearestPoint({ x: prefs.x, y: prefs.y });
  if (!display) return fallbackPos();
  const wa = display.workArea;
  const visible =
    prefs.x + WIN_W > wa.x + 40 &&
    prefs.x < wa.x + wa.width - 40 &&
    prefs.y + height > wa.y + 20 &&
    prefs.y < wa.y + wa.height - 20;
  return visible ? { x: prefs.x, y: prefs.y } : fallbackPos();
}

function applyWindowPrefs(prefs) {
  if (!win || win.isDestroyed()) return;
  win.setOpacity(prefs.opacity);
  win.setAlwaysOnTop(prefs.alwaysOnTop, 'screen-saver');
  win.setIgnoreMouseEvents(prefs.clickThrough, { forward: true });
  const h = prefs.compact ? WIN_H_COMPACT : WIN_H;
  const [, curH] = win.getSize();
  if (curH === h) return;
  // A non-resizable window pins its size through WM_GETMINMAXINFO on Windows,
  // so setSize alone silently does nothing here — compact mode would hide the
  // content and leave the empty frame behind. Lift the flag for the call only.
  const resizable = win.isResizable();
  if (!resizable) win.setResizable(true);
  win.setSize(WIN_W, h, false);
  if (!resizable) win.setResizable(false);
}

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

function iconPath(name) {
  return path.join(__dirname, 'assets', name);
}

function createWindow(prefs) {
  const height = prefs.compact ? WIN_H_COMPACT : WIN_H;
  const pos = resolvePosition(prefs, height);
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
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => {
    applyWindowPrefs(settings.all());
    win.show();
  });
  win.on('moved', persistPosition);
  win.on('closed', () => {
    win = null;
  });
}

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
    {
      label: 'Iniciar com o Windows',
      type: 'checkbox',
      checked: prefs.autoStart,
      click: (item) => updateSettings({ autoStart: item.checked }),
    },
    { type: 'separator' },
    { label: 'Abrir pasta de dados', click: () => shell.openPath(path.dirname(logger.logPath())) },
    { label: `Versão ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() },
  ]);
}

function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(iconPath('tray.png'));
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
    tray.setToolTip('Steam Spec Overlay');
    tray.on('click', toggleWindow);
    refreshTray();
  } catch (e) {
    log.warn('tray unavailable', e);
  }
}

// ---- settings ------------------------------------------------------------
function applyAutoStart(enabled) {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
  } catch (e) {
    log.warn('could not set login item', e);
  }
}

function updateSettings(changes) {
  const changed = settings.patch(changes);
  if (Object.keys(changed).length === 0) return settings.all();
  const prefs = settings.all();
  if ('logLevel' in changed) logger.setLevel(prefs.logLevel);
  if ('autoStart' in changed) applyAutoStart(prefs.autoStart);
  if (
    'opacity' in changed ||
    'alwaysOnTop' in changed ||
    'clickThrough' in changed ||
    'compact' in changed
  ) {
    applyWindowPrefs(prefs);
  }
  state.settings = prefs;
  refreshTray();
  pushState();
  return prefs;
}

// ---- startup -------------------------------------------------------------
async function bootstrap() {
  const prefs = settings.all();
  logger.setLevel(prefs.logLevel);
  state.settings = prefs;
  log.info('starting', app.getVersion());

  tables = compareLib.loadTables();
  createWindow(prefs);
  createTray();

  // detect specs (disk-cached, so usually resolves before the first paint)
  detectSpecs().then((specs) => {
    state.specs = specs;
    pushState();
  });

  poller = dbg.createPoller({
    onGame: (game) => {
      // Only assert a live connection on a real game target. onGame(null) also
      // fires when the CDP endpoint dies mid-tick — let onStatus own that flag.
      if (game) {
        cdpConnected = true;
        cdpMissTicks = 0;
        state.mode = 'cdp';
      }
      handleGame(game, 'cdp');
    },
    onStatus: ({ connected, port }) => {
      cdpConnected = connected;
      state.cdpPort = port;
      if (connected) cdpMissTicks = 0;
    },
  });
  poller.start();

  envTick();
  envTimer = setInterval(envTick, 3000);
}

// ---- IPC -----------------------------------------------------------------
ipcMain.handle('getState', () => state);

ipcMain.handle('enableDebug', async () => {
  const res = await setup.ensureDebugFlag({ create: true });
  state.flagExists = res.flagExists;
  state.steamPath = res.steamPath;
  pushState();
  return res;
});

ipcMain.handle('retry', async () => {
  if (!state.game) return false;
  const { appid, title, source } = state.game;
  currentKey = null;
  try {
    // force a refetch, bypassing the disk cache for this appid
    await steamApi.getGameInfo(appid, { force: true });
  } catch (e) {
    log.debug('forced refetch failed; handleGame will report it', e);
  }
  await handleGame({ appid, title }, source || 'cdp');
  return true;
});

ipcMain.handle('setSettings', (_e, changes) => updateSettings(changes || {}));

ipcMain.on('openSteamFolder', () => {
  if (state.steamPath) shell.openPath(state.steamPath);
});

ipcMain.on('openDataFolder', () => shell.openPath(path.dirname(logger.logPath())));

ipcMain.on('hide', () => {
  if (win) win.hide();
  refreshTray();
});

ipcMain.on('quit', () => app.quit());

// ---- app lifecycle -------------------------------------------------------
const SHORTCUTS = ['CommandOrControl+Shift+S', 'CommandOrControl+Alt+S', 'CommandOrControl+Shift+F10'];

function toggleWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) win.hide();
  else {
    win.show();
    win.focus();
  }
  refreshTray();
}

// Register the first accelerator that the OS grants. register() returns false
// (no throw) when another app already owns the combo; without a fallback a
// hidden overlay could become unrecoverable.
function registerShortcut() {
  for (const acc of SHORTCUTS) {
    try {
      if (globalShortcut.register(acc, toggleWindow)) {
        state.shortcut = acc;
        pushState();
        return;
      }
    } catch {
      /* try next */
    }
  }
  state.shortcut = null; // none available — tray menu and relaunch still re-show
  pushState();
}

// Single-instance lock: relaunching the app re-shows the window. This is the
// safety net if no global accelerator could be registered.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
      refreshTray();
    }
  });
  app.whenReady().then(() => {
    bootstrap();
    registerShortcut();
  });
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (poller) poller.stop();
  if (envTimer) clearInterval(envTimer);
  if (moveTimer) clearTimeout(moveTimer);
  settings.flush();
  cache.flush();
});

app.on('window-all-closed', () => {
  app.quit();
});
