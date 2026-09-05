/**
 * The state every part of the main process shares: the window, the running
 * server, its tunnel, and the helpers that act on them.
 *
 * The IPC modules are thin by design — they translate a channel into one of
 * these calls — so this is where the behaviour actually lives.
 */
const fs = require('fs');
const { ipcMain } = require('electron');

const Settings = require('./settings');
const Installer = require('./installer');
const platforms = require('./platforms');
const backups = require('./backupManager');
const i18n = require('./i18n');

/* Filled in by main.js once the window and managers exist. */
const ctx = {
  win: null,
  server: null,
  tunnel: null,
  scheduler: null,
  tray: null,
  wake: null,
  strings: {},
};

const send = (channel, payload) => {
  if (ctx.win && !ctx.win.isDestroyed()) ctx.win.webContents.send(channel, payload);
};

/** Main-process translation, for the tray and the sleeping-server messages. */
function t(key, vars) {
  let out = ctx.strings[key];
  if (out == null) return key;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

function loadStrings() {
  ctx.strings = i18n.bundle(Settings.get('language') || 'en');
}

function currentServer() {
  const settings = Settings.activeServer();
  if (!settings) return { settings: null, info: { installed: false } };
  return { settings, info: Installer.inspectServer(settings.serverPath) };
}

/** Persists a patch onto the active server entry. */
function patchActive(patch) {
  const id = Settings.get('activeServerId');
  return id ? Settings.updateServer(id, patch) : null;
}

async function startServer() {
  const { settings, info } = currentServer();
  if (!settings) return { ok: false, error: 'NO_SERVER' };
  if (!info.installed) return { ok: false, error: 'NOT_INSTALLED' };

  // The wake listener owns the port while the server sleeps.
  if (ctx.wake?.listening) await ctx.wake.stop();

  const javaMajor = Installer.requiredJava(info.minecraft || settings.minecraft || '1.21');
  let javaPath = settings.javaPath;
  if (!javaPath || !fs.existsSync(javaPath)) {
    const found = await Installer.detectJava(javaMajor);
    javaPath = found.best?.path;
    if (!javaPath) return { ok: false, error: `JAVA_MISSING:${javaMajor}` };
    patchActive({ javaPath });
  }

  const platform = platforms.PLATFORMS[info.platform || settings.platform];

  return ctx.server.start({
    serverPath: settings.serverPath,
    javaPath,
    ramGb: settings.ramGb,
    platform: info.platform || settings.platform,
    platformName: platform?.name,
    version: info.version || settings.build,
  });
}

function showWindow() {
  // Required lazily: window.js needs this module, so a top-level require here
  // would close the loop and leave one of the two half-built.
  if (!ctx.win || ctx.win.isDestroyed()) return require('./window').createWindow(() => false);
  if (ctx.win.isMinimized()) ctx.win.restore();
  ctx.win.show();
  ctx.win.focus();
}

/** Holds the port while the server is off, so joining wakes it. */
async function armWake() {
  const { settings, info } = currentServer();
  if (!settings || !Settings.get('wakeOnDemand')) return;
  if (ctx.server.getState().status !== 'stopped') return;

  const res = await ctx.wake.listen({
    port: settings.port || 25565,
    motd: settings.name,
    version: info.minecraft || '',
  });
  if (!res.ok && res.error !== 'PORT_BUSY') {
    send('server:log', { line: `Wake-on-demand: ${res.error}`, level: 'error', ts: Date.now() });
  }
}

/** Shuts an empty server down once the idle window passes. */
function handleIdle(state) {
  if (!Settings.get('wakeOnDemand')) return;

  const minutes = Settings.get('wakeIdleMinutes') || 10;
  if (state.status === 'running' && state.players.length === 0) {
    ctx.wake.armIdle(minutes, async () => {
      if (ctx.server.getState().players.length) return;
      send('server:log', {
        line: 'Nobody around; putting the server to sleep.', level: 'system', ts: Date.now(),
      });
      await stopServer();
    });
  } else {
    ctx.wake.cancelIdle();
  }
}

/** Stops the server, its tunnel, and hands the port back to wake-on-demand. */
async function stopServer() {
  const { settings } = currentServer();
  if (settings?.backupOnStop && ctx.server.getState().status === 'running') {
    const worldsFound = backups.worldFolders(settings.serverPath, 'world');
    if (worldsFound.length) {
      send('task:progress', { label: 'backup', percent: 0 });
      await createBackup({ label: 'auto' });
      send('task:progress', { label: '', percent: 100, done: true });
    }
  }
  await ctx.tunnel.stop();
  const res = await ctx.server.stop({ save: true });
  if (Settings.get('wakeOnDemand')) setTimeout(() => armWake(), 1200);
  return res;
}

async function createBackup({ label = '' } = {}) {
  const { settings, info } = currentServer();
  if (!settings) return { ok: false, error: 'NO_SERVER' };
  const running = ctx.server.getState().status === 'running';
  return backups.create({
    serverPath: settings.serverPath,
    levelName: info.levelName || 'world',
    label,
    keep: settings.backupsKeep,
    isRunning: running,
    sendCommand: (c) => ctx.server.sendCommand(c),
    waitForSave: () => ctx.server.waitForSave(),
    onProgress: (p) => send('task:progress', p),
  });
}

const handle = (channel, fn) => ipcMain.handle(channel, async (_e, ...args) => {
  try {
    return await fn(...args);
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

module.exports = {
  ctx, send, t, loadStrings, handle,
  currentServer, patchActive, startServer, stopServer, createBackup,
  showWindow, armWake, handleIdle,
};
