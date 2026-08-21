const path = require('path');
const { app, Tray, Menu, nativeImage } = require('electron');

const ICON = path.join(__dirname, '..', '..', 'assets', 'icon.ico');

/**
 * System tray presence: a status line, the power controls, and the address to
 * share. Everything here mirrors the window, never replaces it.
 */
class TrayController {
  constructor({ t, getState, onShow, onStart, onStop, onQuit, onCopyAddress }) {
    this.t = t;
    this.getState = getState;
    this.onShow = onShow;
    this.onStart = onStart;
    this.onStop = onStop;
    this.onQuit = onQuit;
    this.onCopyAddress = onCopyAddress;
    this.tray = null;
  }

  create() {
    if (this.tray) return;

    const image = nativeImage.createFromPath(ICON);
    this.tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
    this.tray.setToolTip('MineHost');
    this.tray.on('double-click', () => this.onShow());
    this.refresh();
  }

  destroy() {
    this.tray?.destroy();
    this.tray = null;
  }

  /** Rebuilds the menu; Electron has no way to mutate items in place. */
  refresh() {
    if (!this.tray) return;

    const { serverName, status, players, address } = this.getState();
    const t = this.t;

    const running = status === 'running';
    const busy = status === 'starting' || status === 'stopping';

    const header = serverName
      ? `${serverName} · ${t(`status.${status}`)}`
      : t('servers.empty');

    const items = [
      { label: header, enabled: false },
    ];

    if (running && players.length) {
      items.push({
        label: t('panel.playersOnline'),
        submenu: players.map((p) => ({ label: p, enabled: false })),
      });
    }

    items.push({ type: 'separator' });
    items.push({ label: t('servers.open'), click: () => this.onShow() });

    if (address) {
      items.push({
        label: `${t('common.copy')}: ${address}`,
        click: () => this.onCopyAddress(address),
      });
    }

    items.push({ type: 'separator' });
    items.push({
      label: running ? t('panel.powerStop') : t('panel.powerStart'),
      enabled: !busy && !!serverName,
      click: () => (running ? this.onStop() : this.onStart()),
    });

    items.push({ type: 'separator' });
    items.push({ label: t('common.close'), click: () => this.onQuit() });

    this.tray.setContextMenu(Menu.buildFromTemplate(items));
    this.tray.setToolTip(serverName ? `MineHost — ${header}` : 'MineHost');
  }
}

/** Windows run-at-login, managed through Electron rather than the registry. */
function setAutoLaunch(enabled, { minimised = true } = {}) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    // Started by Windows we go straight to the tray, out of the way.
    args: minimised ? ['--hidden'] : [],
  });
  return getAutoLaunch();
}

function getAutoLaunch() {
  const settings = app.getLoginItemSettings();
  return { enabled: settings.openAtLogin, wasOpenedAtLogin: settings.wasOpenedAtLogin };
}

module.exports = { TrayController, setAutoLaunch, getAutoLaunch };
