'use strict';
const { app, BrowserWindow, ipcMain, globalShortcut, screen, shell } = require('electron');
const path = require('path');

const setup = require('./lib/steamSetup');
const dbg = require('./lib/steamDebug');
const scraper = require('./lib/steamScraper');
const { detectSpecs } = require('./lib/detectSpecs');
const compareLib = require('./lib/compare');
const fallback = require('./lib/windowFallback');

let win = null;
let poller = null;
let envTimer = null;
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
  game: null, // { appid, title, source }
  loadingReq: false,
  requirements: null, // { available, minimum, recommended }
  requirementsError: null, // 'network' | 'unavailable' | null
  comparison: null, // { minimum, recommended }
  shortcut: null, // active global show/hide accelerator, or null if none registered
  updatedAt: 0,
};

function pushState() {
  state.updatedAt = Date.now();
  if (win && !win.isDestroyed()) win.webContents.send('state', state);
}

// ---- game handling -------------------------------------------------------
let currentKey = null; // `${source}:${appid}` to dedupe redundant work

async function handleGame(game, source) {
  if (!game) {
    if (currentKey !== null) {
      currentKey = null;
      state.game = null;
      state.requirements = null;
      state.requirementsError = null;
      state.comparison = null;
      state.loadingReq = false;
      pushState();
    }
    return;
  }
  const key = `${source}:${game.appid}`;
  if (key === currentKey) return; // already handling/handled this game (retry clears currentKey)
  currentKey = key;

  state.game = { appid: game.appid, title: game.title || null, source };
  state.loadingReq = true;
  state.requirements = null;
  state.requirementsError = null;
  state.comparison = null;
  pushState();

  try {
    const req = await scraper.getRequirements(game.appid);
    // guard against a newer game having been selected while we awaited
    if (currentKey !== key) return;
    // specs may still be detecting if a game resolved first — wait for them
    // (cached, so this is instant once detected) so compare never sees null
    if (!state.specs) state.specs = await detectSpecs();
    if (currentKey !== key) return;
    state.requirements = req;
    if (req.available) {
      state.comparison = compareLib.compare(state.specs, req, tables);
      state.requirementsError = null;
    } else {
      state.comparison = null;
      state.requirementsError = 'unavailable';
    }
  } catch (e) {
    if (currentKey !== key) return;
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
    const [running, flag] = await Promise.all([setup.isSteamRunning(), setup.debugFlagStatus()]);
    state.steamRunning = running;
    state.steamPath = flag.steamPath;
    state.flagExists = flag.flagExists;

    if (cdpConnected) {
      cdpMissTicks = 0;
    } else {
      cdpMissTicks++;
    }
    const cdpDown = !cdpConnected && cdpMissTicks >= CDP_GRACE_TICKS;

    if (cdpConnected) {
      // CDP owns detection; onGame drives game state. Mode reflects it.
      if (state.mode !== 'cdp') {
        state.mode = 'cdp';
        pushState();
      }
      return;
    }

    // CDP not connected -> decide mode + try fallback
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
    if (cdpDown) {
      const guess = await fallback.getFallbackGame();
      if (cdpConnected) return; // CDP reconnected during the await; let it own detection
      if (guess) {
        if (state.mode !== 'fallback') {
          state.mode = 'fallback';
        }
        await handleGame(guess, 'fallback');
        return;
      }
      setNoGameMode('setup'); // flag there, no CDP, no fallback hit -> ask to restart Steam
    }
  } catch {
    /* ignore transient errors */
  }
}

function setNoGameMode(mode) {
  const changed = state.mode !== mode || state.game !== null;
  state.mode = mode;
  if (state.game !== null || currentKey !== null) {
    currentKey = null;
    state.game = null;
    state.requirements = null;
    state.comparison = null;
    state.requirementsError = null;
    state.loadingReq = false;
  }
  if (changed) pushState();
}

// ---- window --------------------------------------------------------------
function createWindow() {
  const primary = screen.getPrimaryDisplay();
  const wa = primary.workArea;
  const W = 360;
  const H = 520;
  win = new BrowserWindow({
    width: W,
    height: H,
    x: wa.x + wa.width - W - 24,
    y: wa.y + 24,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile('index.html');
  win.once('ready-to-show', () => win.show());
}

// ---- startup -------------------------------------------------------------
async function bootstrap() {
  tables = compareLib.loadTables();
  createWindow();

  // detect specs once (async, off render thread)
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
      if (connected) {
        cdpMissTicks = 0;
      }
    },
  });
  poller.start();

  envTick();
  envTimer = setInterval(envTick, 3000);
}

// ---- IPC -----------------------------------------------------------------
ipcMain.handle('enableDebug', async () => {
  const res = await setup.ensureDebugFlag({ create: true });
  state.flagExists = res.flagExists;
  state.steamPath = res.steamPath;
  pushState();
  return res;
});

ipcMain.handle('retry', async () => {
  if (state.game) {
    scraper._clearCache();
    currentKey = null;
    await handleGame({ appid: state.game.appid, title: state.game.title }, state.game.source || 'cdp');
  }
  return true;
});

ipcMain.on('openSteamFolder', () => {
  if (state.steamPath) shell.openPath(state.steamPath);
});

ipcMain.on('hide', () => {
  if (win) win.hide();
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
}

// Register the first accelerator that the OS grants. register() returns false
// (no throw) when another app already owns the combo; without a fallback a
// hidden overlay could become unrecoverable.
function registerShortcut() {
  for (const acc of SHORTCUTS) {
    try {
      if (globalShortcut.register(acc, toggleWindow)) {
        state.shortcut = acc;
        return;
      }
    } catch {
      /* try next */
    }
  }
  state.shortcut = null; // none available — relaunch (single-instance) still re-shows
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
});

app.on('window-all-closed', () => {
  app.quit();
});
