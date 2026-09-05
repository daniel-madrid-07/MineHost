/**
 * The application window: its shape, where it remembers being, and the rule
 * that closing it only hides it while the tray is enabled.
 */
const path = require('path');
const { BrowserWindow, Menu, dialog } = require('electron');

const Settings = require('./settings');
const { ctx, t } = require('./context');

/* Matches --bg in the renderer's tokens, so there is no flash before paint. */
const CHROME = '#0E0D0C';

/**
 * @param {() => boolean} isQuitting  Lets the close handler tell a real quit
 *   from the tray's hide-instead-of-close behaviour.
 */
function createWindow(isQuitting) {
  const bounds = Settings.get('windowBounds') || {};

  const win = new BrowserWindow({
    width: bounds.width || 1240,
    height: bounds.height || 820,
    x: bounds.x,
    y: bounds.y,
    minWidth: 1020,
    minHeight: 680,
    backgroundColor: CHROME,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: CHROME, symbolColor: '#B5AEA5', height: 38 },
    icon: path.join(__dirname, '../../assets/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  ctx.win = win;

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
    dialog.showErrorBox('MineHost', t('err.INTERFACE_LOAD', { code, desc }));
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
  win.on('closed', () => { ctx.win = null; });

  // With the tray enabled, closing the window leaves the server running.
  win.on('close', (e) => {
    if (isQuitting() || !Settings.get('minimiseToTray')) return;
    e.preventDefault();
    saveBounds();
    win.hide();
  });

  return win;
}

module.exports = { createWindow };
