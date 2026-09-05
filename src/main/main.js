/**
 * Entry point. Creates the long-lived managers, hands them to the shared
 * context, loads the IPC handlers, and opens the window.
 *
 * Anything with real behaviour lives elsewhere: context.js owns the state and
 * the operations on it, ipc/ maps channels onto those operations, and the
 * managers in this folder each own one concern.
 */
const { app, BrowserWindow, clipboard } = require('electron');

const Settings = require('./settings');
const ServerManager = require('./serverManager');
const NgrokManager = require('./ngrokManager');
const Scheduler = require('./scheduler');
const WakeOnDemand = require('./wakeOnDemand');
const { TrayController } = require('./tray');

const {
  ctx, send, t, loadStrings,
  currentServer, startServer, stopServer, createBackup,
  showWindow, armWake, handleIdle,
} = require('./context');
const { createWindow } = require('./window');

let quitting = false;
const isQuitting = () => quitting;

/* The IPC modules register their handlers as they load. */
require('./ipc');

/** Wires the managers together and stores them on the shared context. */
function createManagers() {
  ctx.server = new ServerManager({
    onLog: (l) => send('server:log', l),
    onState: (st) => {
      send('server:state', st);
      ctx.tray?.refresh();
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

  ctx.tunnel = new NgrokManager({
    onLog: (l) => send('ngrok:log', l),
    onState: (s) => send('ngrok:state', s),
  });

  ctx.scheduler = new Scheduler({
    t,
    onLog: (l) => send('server:log', l),
    isRunning: () => ctx.server.getState().status === 'running',
    runRestart: async ({ announceOnly, message }) => {
      if (announceOnly) return ctx.server.sendCommand(`say ${message}`);
      await ctx.server.stop({ save: true });
      setTimeout(() => startServer().catch(() => {}), 4000);
    },
    runBackup: (label) => createBackup({ label }),
  });
  ctx.scheduler.configure(Settings.activeServer()?.schedule || {});

  ctx.wake = new WakeOnDemand({
    onWake: () => startServer(),
    onLog: (l) => send('server:log', l),
    getStatus: () => ({
      sleepingText: t('wake.sleeping'),
      startingText: t('wake.starting'),
      wakingText: t('wake.waking'),
    }),
  });

  ctx.tray = new TrayController({
    t,
    getState: () => {
      const active = Settings.activeServer();
      const state = ctx.server.getState();
      return {
        serverName: active?.name || null,
        status: state.status,
        players: state.players,
        address: ctx.tunnel.getState().address,
      };
    },
    onShow: () => showWindow(),
    onStart: () => startServer(),
    onStop: () => stopServer(),
    onQuit: () => { quitting = true; app.quit(); },
    onCopyAddress: (address) => clipboard.writeText(address),
  });
}

/**
 * A server may already be running: started by a script, or left up when the
 * app was last closed. This waits for the interface before adopting it,
 * otherwise the state message goes to a window that cannot receive it yet.
 */
async function adoptWhenReady() {
  const { settings } = currentServer();
  if (settings) {
    const state = await ctx.server.adoptExisting({
      serverPath: settings.serverPath,
      port: settings.port || 25565,
    });
    if (state.external) {
      send('server:state', state);
      ctx.tray?.refresh();
      return;   // Wake-on-demand would fight it for the port.
    }
  }
  if (Settings.get('wakeOnDemand')) armWake();
}

app.whenReady().then(() => {
  Settings.init(app.getPath('userData'));
  loadStrings();
  createManagers();

  if (Settings.get('minimiseToTray')) ctx.tray.create();

  const win = createWindow(isQuitting);

  // Launched by Windows at login we stay out of the way, in the tray.
  if (process.argv.includes('--hidden') && Settings.get('minimiseToTray')) {
    win.once('ready-to-show', () => win.hide());
  }

  if (win) {
    win.webContents.once('did-finish-load', () => setTimeout(adoptWhenReady, 400));
  } else {
    setTimeout(adoptWhenReady, 1500);
  }

  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow(isQuitting);
  });
});

async function shutdown() {
  if (quitting) return;
  quitting = true;
  ctx.scheduler?.stop();
  ctx.tray?.destroy();
  try { await ctx.wake?.stop(); } catch (_) {}
  try { await ctx.tunnel?.stop(); } catch (_) {}
  try { await ctx.server?.stop({ force: true, save: true }); } catch (_) {}
}

app.on('window-all-closed', async () => {
  // With the tray on, the app keeps running without a window.
  if (Settings.get('minimiseToTray') && !quitting) return;
  await shutdown();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', shutdown);
