const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ServerManager = require('./serverManager');
const NgrokManager = require('./ngrokManager');
const Installer = require('./installer');
const Settings = require('./settings');

let mainWindow = null;
let serverManager = null;
let ngrokManager = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 640,
    backgroundColor: '#12100E',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../../assets/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

app.whenReady().then(() => {
  Settings.init(app.getPath('userData'));

  serverManager = new ServerManager({
    onLog: (line) => send('server:log', line),
    onState: (state) => send('server:state', state),
  });

  ngrokManager = new NgrokManager({
    onLog: (line) => send('ngrok:log', line),
    onState: (state) => send('ngrok:state', state),
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  await shutdownAll();
  if (process.platform !== 'darwin') app.quit();
});

let shuttingDown = false;
async function shutdownAll() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { await ngrokManager?.stop(); } catch (_) {}
  try { await serverManager?.stop(true); } catch (_) {}
}

app.on('before-quit', shutdownAll);

/* ---------------------------- Settings / config --------------------------- */

ipcMain.handle('settings:get', () => Settings.getAll());

ipcMain.handle('settings:set', (_e, patch) => {
  Settings.merge(patch);
  return Settings.getAll();
});

ipcMain.handle('dialog:pickFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));
ipcMain.handle('shell:openExternal', (_e, url) => shell.openExternal(url));

/* --------------------------------- Java ---------------------------------- */

ipcMain.handle('java:detect', async () => Installer.detectJava());

/* ------------------------------- Installer -------------------------------- */

ipcMain.handle('installer:versions', async () => Installer.listNeoForgeVersions());

ipcMain.handle('installer:install', async (_e, { serverPath, neoforgeVersion }) => {
  return Installer.installServer({
    serverPath,
    neoforgeVersion,
    onProgress: (p) => send('installer:progress', p),
  });
});

ipcMain.handle('installer:status', async (_e, serverPath) => Installer.inspectServer(serverPath));

/* ------------------------------ Server control ---------------------------- */

ipcMain.handle('server:start', async (_e, opts) => serverManager.start(opts));
ipcMain.handle('server:stop', async () => serverManager.stop(false));
ipcMain.handle('server:command', async (_e, cmd) => serverManager.sendCommand(cmd));
ipcMain.handle('server:state', () => serverManager.getState());

/* --------------------------------- ngrok ---------------------------------- */

ipcMain.handle('ngrok:ensure', async () => {
  return NgrokManager.ensureBinary((p) => send('installer:progress', p));
});

ipcMain.handle('ngrok:setToken', async (_e, token) => ngrokManager.setAuthToken(token));
ipcMain.handle('ngrok:start', async (_e, port) => ngrokManager.start(port));
ipcMain.handle('ngrok:stop', async () => ngrokManager.stop());
ipcMain.handle('ngrok:state', () => ngrokManager.getState());

/* ------------------------------ properties -------------------------------- */

ipcMain.handle('props:read', (_e, serverPath) => {
  const file = path.join(serverPath, 'server.properties');
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1).replace(/\\:/g, ':');
  }
  return out;
});

ipcMain.handle('props:write', (_e, { serverPath, values }) => {
  const file = path.join(serverPath, 'server.properties');
  let lines = [];
  const seen = new Set();

  if (fs.existsSync(file)) {
    lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((raw) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return raw;
      const idx = line.indexOf('=');
      if (idx === -1) return raw;
      const key = line.slice(0, idx);
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        seen.add(key);
        return `${key}=${String(values[key])}`;
      }
      return raw;
    });
  }

  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) lines.push(`${key}=${String(value)}`);
  }

  fs.mkdirSync(serverPath, { recursive: true });
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return true;
});

/* --------------------------------- EULA ----------------------------------- */

ipcMain.handle('eula:accept', (_e, serverPath) => {
  fs.mkdirSync(serverPath, { recursive: true });
  fs.writeFileSync(path.join(serverPath, 'eula.txt'), 'eula=true\n', 'utf8');
  return true;
});

/* --------------------------------- Mods ----------------------------------- */

function modsDir(serverPath) {
  const dir = path.join(serverPath, 'mods');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

ipcMain.handle('mods:list', (_e, serverPath) => {
  const dir = modsDir(serverPath);
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jar') || f.endsWith('.jar.disabled'))
    .map((f) => {
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      return {
        name: f.replace(/\.disabled$/, ''),
        file: f,
        enabled: !f.endsWith('.disabled'),
        size: st.size,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
});

ipcMain.handle('mods:add', (_e, { serverPath, files }) => {
  const dir = modsDir(serverPath);
  let added = 0;
  for (const src of files) {
    if (!src.toLowerCase().endsWith('.jar')) continue;
    fs.copyFileSync(src, path.join(dir, path.basename(src)));
    added++;
  }
  return added;
});

ipcMain.handle('mods:toggle', (_e, { serverPath, file }) => {
  const dir = modsDir(serverPath);
  const from = path.join(dir, file);
  const to = file.endsWith('.disabled')
    ? path.join(dir, file.replace(/\.disabled$/, ''))
    : `${from}.disabled`;
  fs.renameSync(from, to);
  return true;
});

ipcMain.handle('mods:remove', (_e, { serverPath, file }) => {
  fs.unlinkSync(path.join(modsDir(serverPath), file));
  return true;
});

ipcMain.handle('mods:pickFiles', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Mods de Minecraft', extensions: ['jar'] }],
  });
  if (res.canceled) return [];
  return res.filePaths;
});

/* ------------------------------- System info ------------------------------ */

ipcMain.handle('system:ram', () => Math.round(require('os').totalmem() / 1024 / 1024 / 1024));
