const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const Settings = require('./settings');
const Installer = require('./installer');
const ServerManager = require('./serverManager');
const NgrokManager = require('./ngrokManager');
const Scheduler = require('./scheduler');
const platforms = require('./platforms');
const players = require('./playerManager');
const backups = require('./backupManager');
const worlds = require('./worldManager');
const modrinth = require('./modrinth');
const catalog = require('./catalog');
const i18n = require('./i18n');
const updater = require('./updater');
const network = require('./network');
const fileManager = require('./fileManager');
const { TrayController, setAutoLaunch, getAutoLaunch } = require('./tray');
const WakeOnDemand = require('./wakeOnDemand');

let win = null;
let server = null;
let tunnel = null;
let scheduler = null;
let tray = null;
let wake = null;
let strings = {};

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

/** Main-process translation, for the tray and the sleeping-server messages. */
function t(key, vars) {
  let out = strings[key];
  if (out == null) return key;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

function loadStrings() {
  strings = i18n.bundle(Settings.get('language') || 'en');
}

/* ------------------------------- Window ---------------------------------- */

function createWindow() {
  const bounds = Settings.get('windowBounds') || {};

  win = new BrowserWindow({
    width: bounds.width || 1240,
    height: bounds.height || 820,
    x: bounds.x,
    y: bounds.y,
    minWidth: 1020,
    minHeight: 680,
    backgroundColor: '#0E0D0C',
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0E0D0C', symbolColor: '#B5AEA5', height: 38 },
    icon: path.join(__dirname, '../../assets/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Never leave an invisible window behind: if the renderer stalls, show anyway.
  const reveal = () => {
    if (win && !win.isDestroyed() && !win.isVisible()) win.show();
  };
  win.once('ready-to-show', reveal);
  const revealTimer = setTimeout(reveal, 4000);

  win.webContents.on('did-fail-load', (_e, code, desc) => {
    clearTimeout(revealTimer);
    reveal();
    dialog.showErrorBox('MineHost', `No se pudo cargar la interfaz (${code}): ${desc}`);
  });

  if (process.env.MINEHOST_DEBUG) {
    win.webContents.on('console-message', (_e, level, message, line, source) => {
      process.stderr.write(`[renderer:${level}] ${message} (${source}:${line})\n`);
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      process.stderr.write(`[renderer-gone] ${JSON.stringify(details)}\n`);
    });
  }

  const saveBounds = () => {
    if (win && !win.isDestroyed() && !win.isMaximized()) {
      Settings.merge({ windowBounds: win.getBounds() });
    }
  };
  win.on('resized', saveBounds);
  win.on('moved', saveBounds);
  win.on('closed', () => { win = null; });

  // With the tray enabled, closing the window leaves the server running.
  win.on('close', (e) => {
    if (quitting || !Settings.get('minimiseToTray')) return;
    e.preventDefault();
    saveBounds();
    win.hide();
  });
}

/* ------------------------------ Bootstrap -------------------------------- */

app.whenReady().then(() => {
  Settings.init(app.getPath('userData'));

  loadStrings();

  server = new ServerManager({
    onLog: (l) => send('server:log', l),
    onState: (st) => {
      send('server:state', st);
      tray?.refresh();
      handleIdle(st);
    },
    onStats: (s) => send('server:stats', s),
    onEvent: (e) => send('server:event', e),
    onCrash: async ({ code, reason }) => {
      send('server:crash', { code, reason });
      const active = Settings.activeServer();
      // Some failures repeat forever: a busy port, an unaccepted EULA, or mods
      // that do not match the server. Retrying those just spams the console.
      const permanent = reason === 'port' || reason === 'eula' || reason === 'mods';
      if (!permanent && active?.autoRestartOnCrash) {
        send('server:log', {
          line: 'Restarting automatically in 5 seconds…', level: 'system', ts: Date.now(),
        });
        setTimeout(() => startServer().catch(() => {}), 5000);
      }
    },
  });

  tunnel = new NgrokManager({
    onLog: (l) => send('ngrok:log', l),
    onState: (s) => send('ngrok:state', s),
  });

  scheduler = new Scheduler({
    onLog: (l) => send('server:log', l),
    isRunning: () => server.getState().status === 'running',
    runRestart: async ({ announceOnly, message }) => {
      if (announceOnly) return server.sendCommand(`say ${message}`);
      await server.stop({ save: true });
      setTimeout(() => startServer().catch(() => {}), 4000);
    },
    runBackup: (label) => createBackup({ label }),
  });
  scheduler.configure(Settings.activeServer()?.schedule || {});

  wake = new WakeOnDemand({
    onWake: () => startServer(),
    onLog: (l) => send('server:log', l),
    getStatus: () => ({
      sleepingText: t('wake.sleeping'),
      startingText: t('wake.starting'),
      wakingText: t('wake.waking'),
    }),
  });

  tray = new TrayController({
    t,
    getState: () => {
      const active = Settings.activeServer();
      const state = server.getState();
      return {
        serverName: active?.name || null,
        status: state.status,
        players: state.players,
        address: tunnel.getState().address,
      };
    },
    onShow: () => showWindow(),
    onStart: () => startServer(),
    onStop: () => stopServer(),
    onQuit: () => { quitting = true; app.quit(); },
    onCopyAddress: (address) => require('electron').clipboard.writeText(address),
  });

  if (Settings.get('minimiseToTray')) tray.create();

  createWindow();

  // Launched by Windows at login we stay out of the way, in the tray.
  if (process.argv.includes('--hidden') && Settings.get('minimiseToTray')) {
    win.once('ready-to-show', () => win.hide());
  }
  // A server may already be running: started by a script, or left up when the
  // app was last closed. Wait for the interface before adopting it, otherwise
  // the state message is sent to a window that cannot receive it yet.
  const adoptWhenReady = async () => {
    const { settings } = currentServer();
    if (settings) {
      const state = await server.adoptExisting({
        serverPath: settings.serverPath,
        port: settings.port || 25565,
      });
      if (state.external) {
        send('server:state', state);
        tray?.refresh();
        return;   // Wake-on-demand would fight it for the port.
      }
    }
    if (Settings.get('wakeOnDemand')) armWake();
  };

  if (win) {
    win.webContents.once('did-finish-load', () => setTimeout(adoptWhenReady, 400));
  } else {
    setTimeout(adoptWhenReady, 1500);
  }

  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

let quitting = false;
async function shutdown() {
  if (quitting) return;
  quitting = true;
  scheduler?.stop();
  tray?.destroy();
  try { await wake?.stop(); } catch (_) {}
  try { await tunnel?.stop(); } catch (_) {}
  try { await server?.stop({ force: true, save: true }); } catch (_) {}
}

app.on('window-all-closed', async () => {
  // With the tray on, the app keeps running without a window.
  if (Settings.get('minimiseToTray') && !quitting) return;
  await shutdown();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', shutdown);

/* ------------------------------- Helpers --------------------------------- */

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
  if (wake?.listening) await wake.stop();

  const javaMajor = Installer.requiredJava(info.minecraft || settings.minecraft || '1.21');
  let javaPath = settings.javaPath;
  if (!javaPath || !fs.existsSync(javaPath)) {
    const found = await Installer.detectJava(javaMajor);
    javaPath = found.best?.path;
    if (!javaPath) return { ok: false, error: `JAVA_MISSING:${javaMajor}` };
    patchActive({ javaPath });
  }

  const platform = platforms.PLATFORMS[info.platform || settings.platform];

  return server.start({
    serverPath: settings.serverPath,
    javaPath,
    ramGb: settings.ramGb,
    platform: info.platform || settings.platform,
    platformName: platform?.name,
    version: info.version || settings.build,
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Holds the port while the server is off, so joining wakes it. */
async function armWake() {
  const { settings, info } = currentServer();
  if (!settings || !Settings.get('wakeOnDemand')) return;
  if (server.getState().status !== 'stopped') return;

  const res = await wake.listen({
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
    wake.armIdle(minutes, async () => {
      if (server.getState().players.length) return;
      send('server:log', {
        line: 'Nobody around; putting the server to sleep.', level: 'system', ts: Date.now(),
      });
      await stopServer();
    });
  } else {
    wake.cancelIdle();
  }
}

/** Stops the server, its tunnel, and hands the port back to wake-on-demand. */
async function stopServer() {
  const { settings } = currentServer();
  if (settings?.backupOnStop && server.getState().status === 'running') {
    const worldsFound = backups.worldFolders(settings.serverPath, 'world');
    if (worldsFound.length) {
      send('task:progress', { label: 'backup', percent: 0 });
      await createBackup({ label: 'auto' });
      send('task:progress', { label: '', percent: 100, done: true });
    }
  }
  await tunnel.stop();
  const res = await server.stop({ save: true });
  if (Settings.get('wakeOnDemand')) setTimeout(() => armWake(), 1200);
  return res;
}

async function createBackup({ label = '' } = {}) {
  const { settings, info } = currentServer();
  if (!settings) return { ok: false, error: 'NO_SERVER' };
  const running = server.getState().status === 'running';
  return backups.create({
    serverPath: settings.serverPath,
    levelName: info.levelName || 'world',
    label,
    keep: settings.backupsKeep,
    isRunning: running,
    sendCommand: (c) => server.sendCommand(c),
    waitForSave: () => server.waitForSave(),
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

/* ------------------------------- Settings -------------------------------- */

handle('settings:get', () => Settings.getAll());

handle('settings:set', (patch) => {
  const next = Settings.merge(patch);
  return next;
});

/* -------------------------------- Servers -------------------------------- */

handle('servers:list', () => Settings.listServers().map((s) => {
  const info = Installer.inspectServer(s.serverPath);
  return { ...s, installed: info.installed, minecraft: info.minecraft || s.minecraft };
}));

handle('servers:active', () => {
  const { settings, info } = currentServer();
  return settings ? { ...settings, installed: info.installed } : null;
});

handle('servers:add', (patch) => Settings.addServer(patch));

handle('servers:update', ({ id, patch }) => {
  const next = Settings.updateServer(id, patch);
  if (next && id === Settings.get('activeServerId') && patch.schedule) {
    scheduler.configure(next.schedule);
  }
  return next;
});

handle('servers:remove', async (id) => {
  if (id === Settings.get('activeServerId') && server.getState().status !== 'stopped') {
    return { ok: false, error: 'SERVER_RUNNING' };
  }
  Settings.removeServer(id);
  return { ok: true, servers: Settings.listServers() };
});

handle('servers:select', async (id) => {
  if (server.getState().status !== 'stopped') return { ok: false, error: 'SERVER_RUNNING' };
  await tunnel.stop();
  const next = Settings.setActive(id);
  scheduler.configure(next?.schedule || {});
  await wake.stop();
  server.releaseExternal();

  const state = await server.adoptExisting({
    serverPath: next?.serverPath,
    port: next?.port || 25565,
  });
  if (!state.external && Settings.get('wakeOnDemand')) await armWake();

  tray?.refresh();
  return { ok: true, server: next };
});

/* ------------------------------ Localisation ------------------------------ */

handle('i18n:bundle', (lang) => {
  const id = lang || Settings.get('language') || 'en';
  return { id, strings: i18n.bundle(id), languages: i18n.available() };
});

handle('i18n:set', (lang) => {
  Settings.merge({ language: lang });
  loadStrings();
  tray?.refresh();
  return { id: lang, strings: i18n.bundle(lang) };
});

/* ------------------------------- Updates --------------------------------- */

/* ------------------------------ Tray & wake ------------------------------- */

handle('app:tray', (enabled) => {
  Settings.merge({ minimiseToTray: enabled });
  if (enabled) tray.create();
  else tray.destroy();
  return { ok: true };
});

handle('app:autoLaunch', (enabled) => setAutoLaunch(enabled));
handle('app:autoLaunchState', () => getAutoLaunch());

handle('app:wakeOnDemand', async ({ enabled, idleMinutes }) => {
  Settings.merge({
    wakeOnDemand: enabled,
    wakeIdleMinutes: Math.max(1, idleMinutes || 10),
  });
  if (enabled) await armWake();
  else await wake.stop();
  return { ok: true, listening: wake.listening };
});

handle('app:wakeState', () => ({
  enabled: !!Settings.get('wakeOnDemand'),
  idleMinutes: Settings.get('wakeIdleMinutes') || 10,
  listening: wake?.listening || false,
}));

handle('server:history', () => server.getHistory());

handle('app:checkUpdate', async () => {
  const res = await updater.check(app.getVersion());
  Settings.merge({ lastUpdateCheck: Date.now() });
  return res;
});

/* -------------------------------- Network -------------------------------- */

handle('network:summary', async () => {
  const { settings } = currentServer();
  return network.summary(settings?.port || 25565);
});

handle('network:testPort', async () => {
  const { settings } = currentServer();
  return network.testPort(settings?.port || 25565);
});

handle('network:firewall', async () => {
  const { settings } = currentServer();
  return network.addFirewallRule(settings?.port || 25565);
});

handle('app:info', async () => ({
  version: app.getVersion(),
  platforms: platforms.meta(),
  catalog: { properties: catalog.PROPERTY_GROUPS, gamerules: catalog.GAMERULE_GROUPS },
  totalRamGb: await network.totalRamGb(),
  languages: i18n.available(),
  language: Settings.get('language') || i18n.detect(app.getLocale()),
}));

handle('window:minimize', () => win?.minimize());
handle('window:maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
handle('window:close', () => win?.close());

/* --------------------------------- Dialogs -------------------------------- */

handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

handle('dialog:pickJars', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Mods y plugins', extensions: ['jar'] }],
  });
  return r.canceled ? [] : r.filePaths;
});

handle('dialog:pickZip', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Mundo comprimido', extensions: ['zip'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

handle('dialog:saveZip', async (defaultName) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: defaultName,
    filters: [{ name: 'Archivo ZIP', extensions: ['zip'] }],
  });
  return r.canceled ? null : r.filePath;
});

handle('shell:openPath', (p) => shell.openPath(p));
handle('shell:openExternal', (url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

/* -------------------------------- Installer ------------------------------- */

handle('platform:versions', (id) => platforms.listVersions(id));
handle('installer:status', (p) => Installer.inspectServer(p));
handle('installer:javaFor', (mc) => Installer.requiredJava(mc));

handle('installer:install', async ({ serverId, serverPath, platformId, minecraft, build }) => {
  const res = await Installer.installServer({
    serverPath, platformId, minecraft, build,
    onProgress: (p) => send('task:progress', p),
  });
  const id = serverId || Settings.get('activeServerId');
  if (id) {
    Settings.updateServer(id, {
      serverPath, platform: platformId, minecraft,
      build: res.build, javaPath: res.javaPath,
    });
  }
  return res;
});

/* --------------------------------- Server --------------------------------- */

handle('server:start', () => startServer());
handle('server:stop', () => stopServer());
handle('server:restart', async () => {
  await server.stop({ save: true });
  return startServer();
});
handle('server:command', (cmd) => server.sendCommand(cmd));
handle('server:state', () => server.getState());
handle('server:recentLog', () => server.getRecentLog());
handle('server:recentEvents', () => server.getRecentEvents());

/* ------------------------------ File manager ------------------------------ */

const withServer = (fn) => (...args) => {
  const { settings } = currentServer();
  if (!settings) return { ok: false, error: 'NO_SERVER' };
  return fn(settings.serverPath, ...args);
};

handle('files:list', withServer((root, rel) => fileManager.list(root, rel)));
handle('files:read', withServer((root, rel) => fileManager.read(root, rel)));
handle('files:write', withServer((root, { rel, content }) => fileManager.write(root, rel, content)));
handle('files:remove', withServer((root, rel) => fileManager.remove(root, rel)));
handle('files:rename', withServer((root, { rel, name }) => fileManager.rename(root, rel, name)));
handle('files:newFolder', withServer((root, { rel, name }) => fileManager.createFolder(root, rel, name)));
handle('files:upload', withServer((root, { rel, files }) => fileManager.upload(root, rel, files)));
handle('files:reveal', withServer((root, rel) => {
  const target = fileManager.resolveInside(root, rel);
  return target ? shell.openPath(target) : null;
}));

handle('dialog:pickAny', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});

/* ---------------------------------- ngrok --------------------------------- */

handle('ngrok:ensure', () => NgrokManager.ensureBinary((p) => send('task:progress', p)));
handle('ngrok:allowInDefender', () => NgrokManager.addDefenderExclusion());
handle('ngrok:setToken', async (t) => {
  const res = await tunnel.setAuthToken(t);
  if (res.ok) patchActive({ ngrokToken: t });
  return res;
});
handle('ngrok:start', (port) => {
  const { settings } = currentServer();
  return tunnel.start(port || settings?.port || 25565);
});
handle('ngrok:stop', () => tunnel.stop());
handle('ngrok:state', () => tunnel.getState());

/* ------------------------------- Properties ------------------------------- */

function readProps(serverPath) {
  const file = path.join(serverPath, 'server.properties');
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    out[line.slice(0, i)] = line.slice(i + 1).replace(/\\([:=])/g, '$1');
  }
  return out;
}

handle('props:read', (p) => readProps(p));

handle('props:write', ({ serverPath, values }) => {
  const file = path.join(serverPath, 'server.properties');
  const seen = new Set();
  let lines = [];

  if (fs.existsSync(file)) {
    lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((raw) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return raw;
      const i = line.indexOf('=');
      if (i === -1) return raw;
      const key = line.slice(0, i);
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        seen.add(key);
        return `${key}=${String(values[key])}`;
      }
      return raw;
    });
  }
  for (const [k, v] of Object.entries(values)) {
    if (!seen.has(k)) lines.push(`${k}=${String(v)}`);
  }

  fs.mkdirSync(serverPath, { recursive: true });
  fs.writeFileSync(file, lines.filter((l, i, a) => l !== '' || i < a.length - 1).join('\n'), 'utf8');
  return { ok: true };
});

/* -------------------------------- Gamerules ------------------------------- */

handle('gamerules:set', ({ key, value }) => {
  if (server.getState().status !== 'running') {
    return { ok: false, error: 'Enciende el servidor para cambiar las reglas de juego.' };
  }
  return server.sendCommand(`gamerule ${key} ${value}`);
});

/* --------------------------------- Players -------------------------------- */

handle('players:read', (p) => players.readAll(p));
handle('players:mutate', async ({ list, action, value, opts }) => {
  const { settings } = currentServer();
  const props = readProps(settings.serverPath);
  return players.mutate({
    serverPath: settings.serverPath,
    list, action, value,
    opts: { ...opts, onlineMode: props['online-mode'] !== 'false' },
    isRunning: server.getState().status === 'running',
    sendCommand: (c) => server.sendCommand(c),
  });
});
handle('players:kick', ({ name, reason }) =>
  server.sendCommand(`kick ${name}${reason ? ` ${reason}` : ''}`));

/* --------------------------------- Backups -------------------------------- */

handle('backups:list', (p) => backups.list(p));
handle('backups:create', (label) => createBackup({ label }));
handle('backups:restore', async (file) => {
  const { settings, info } = currentServer();
  return backups.restore({
    serverPath: settings.serverPath,
    file,
    levelName: info.levelName || 'world',
    isRunning: server.getState().status !== 'stopped',
  });
});
handle('backups:remove', (file) => {
  const { settings } = currentServer();
  return backups.remove(settings.serverPath, file);
});
handle('backups:openFolder', () => {
  const { settings } = currentServer();
  return shell.openPath(backups.backupsDir(settings.serverPath));
});

/* ---------------------------------- Worlds -------------------------------- */

handle('worlds:list', () => {
  const { settings } = currentServer();
  const props = readProps(settings.serverPath);
  return worlds.list(settings.serverPath, props['level-name'] || 'world');
});

handle('worlds:activate', (name) => {
  if (server.getState().status !== 'stopped') {
    return { ok: false, error: 'Apaga el servidor antes de cambiar de mundo.' };
  }
  const { settings } = currentServer();
  const file = path.join(settings.serverPath, 'server.properties');
  const props = readProps(settings.serverPath);
  props['level-name'] = name;
  const lines = Object.entries(props).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return { ok: true };
});

handle('worlds:rename', ({ from, to }) => {
  if (server.getState().status !== 'stopped') {
    return { ok: false, error: 'Apaga el servidor antes de renombrar un mundo.' };
  }
  const { settings } = currentServer();
  return worlds.rename(settings.serverPath, from, to);
});

handle('worlds:remove', (name) => {
  if (server.getState().status !== 'stopped') {
    return { ok: false, error: 'Apaga el servidor antes de borrar un mundo.' };
  }
  const { settings } = currentServer();
  const props = readProps(settings.serverPath);
  return worlds.remove(settings.serverPath, name, props['level-name'] || 'world');
});

handle('worlds:resetDimension', ({ world, dimension }) => {
  if (server.getState().status !== 'stopped') {
    return { ok: false, error: 'Apaga el servidor antes de reiniciar una dimensión.' };
  }
  const { settings } = currentServer();
  return worlds.resetDimension(settings.serverPath, world, dimension);
});

handle('worlds:export', async ({ name, dest }) => {
  const { settings } = currentServer();
  return worlds.exportWorld({
    serverPath: settings.serverPath, name, dest,
    onProgress: (p) => send('task:progress', p),
  });
});

handle('worlds:import', ({ zipPath, name }) => {
  if (server.getState().status !== 'stopped') {
    return { ok: false, error: 'Apaga el servidor antes de importar un mundo.' };
  }
  const { settings } = currentServer();
  return worlds.importWorld({ serverPath: settings.serverPath, zipPath, name });
});

/* ----------------------------------- Mods --------------------------------- */

function contentDir(settings, info) {
  const platform = platforms.PLATFORMS[info.platform || settings.platform];
  const dir = platform?.modsDir;
  if (!dir) return null;
  const full = path.join(settings.serverPath, dir);
  fs.mkdirSync(full, { recursive: true });
  return full;
}

handle('mods:list', () => {
  const { settings, info } = currentServer();
  const dir = contentDir(settings, info);
  if (!dir) return { supported: false, items: [] };

  const items = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jar') || f.endsWith('.jar.disabled'))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return {
        file: f,
        name: f.replace(/\.disabled$/, ''),
        enabled: !f.endsWith('.disabled'),
        size: st.size,
        added: st.mtimeMs,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const platform = platforms.PLATFORMS[info.platform || settings.platform];
  return { supported: true, items, kind: platform?.kind, dirName: platform?.modsDir };
});

handle('mods:add', (files) => {
  const { settings, info } = currentServer();
  const dir = contentDir(settings, info);
  if (!dir) return { ok: false, error: 'Esta plataforma no admite mods ni plugins.' };
  let added = 0;
  for (const src of files) {
    if (!src.toLowerCase().endsWith('.jar')) continue;
    fs.copyFileSync(src, path.join(dir, path.basename(src)));
    added++;
  }
  return { ok: true, added };
});

handle('mods:toggle', (file) => {
  const { settings, info } = currentServer();
  const dir = contentDir(settings, info);
  const from = path.join(dir, file);
  const to = file.endsWith('.disabled')
    ? path.join(dir, file.replace(/\.disabled$/, ''))
    : `${from}.disabled`;
  fs.renameSync(from, to);
  return { ok: true };
});

handle('mods:remove', (file) => {
  const { settings, info } = currentServer();
  fs.unlinkSync(path.join(contentDir(settings, info), file));
  return { ok: true };
});

handle('mods:openFolder', () => {
  const { settings, info } = currentServer();
  const dir = contentDir(settings, info);
  return dir ? shell.openPath(dir) : null;
});

/* -------------------------------- Modrinth -------------------------------- */

handle('modrinth:search', ({ query, offset }) => {
  const { settings, info } = currentServer();
  return modrinth.search({
    query,
    offset,
    loader: info.platform || settings.platform,
    gameVersion: info.minecraft || settings.minecraft,
  });
});

handle('modrinth:install', async (projectId) => {
  const { settings, info } = currentServer();
  const dir = contentDir(settings, info);
  if (!dir) return { ok: false, error: 'Esta plataforma no admite mods ni plugins.' };
  return modrinth.install({
    projectId,
    loader: info.platform || settings.platform,
    gameVersion: info.minecraft || settings.minecraft,
    targetDir: dir,
    onProgress: (p) => send('task:progress', p),
  });
});

/* -------------------------------- Datapacks ------------------------------- */

handle('datapacks:list', () => {
  const { settings } = currentServer();
  const props = readProps(settings.serverPath);
  const dir = path.join(settings.serverPath, props['level-name'] || 'world', 'datapacks');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((f) => {
    const st = fs.statSync(path.join(dir, f));
    return { name: f, size: st.isDirectory() ? 0 : st.size, isFolder: st.isDirectory() };
  });
});

handle('datapacks:add', (files) => {
  const { settings } = currentServer();
  const props = readProps(settings.serverPath);
  const dir = path.join(settings.serverPath, props['level-name'] || 'world', 'datapacks');
  fs.mkdirSync(dir, { recursive: true });
  let added = 0;
  for (const src of files) {
    if (!src.toLowerCase().endsWith('.zip')) continue;
    fs.copyFileSync(src, path.join(dir, path.basename(src)));
    added++;
  }
  return { ok: true, added };
});

handle('datapacks:remove', (name) => {
  const { settings } = currentServer();
  const props = readProps(settings.serverPath);
  const target = path.join(settings.serverPath, props['level-name'] || 'world', 'datapacks', name);
  fs.rmSync(target, { recursive: true, force: true });
  return { ok: true };
});

/* ------------------------------- Scheduler -------------------------------- */

handle('schedule:get', () => scheduler.getConfig());
handle('schedule:set', (config) => {
  Settings.merge({ schedule: config });
  return scheduler.configure(config);
});
