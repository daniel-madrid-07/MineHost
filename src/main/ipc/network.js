/**
 * Local addresses, firewall state and port checks.
 */

const { app } = require('electron');
const Settings = require('../settings');
const platforms = require('../platforms');
const catalog = require('../catalog');
const i18n = require('../i18n');
const network = require('../network');
const { ctx, handle, t, currentServer } = require('../context');

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
  platforms: platforms.meta(t),
  catalog: catalog.localise(t),
  totalRamGb: await network.totalRamGb(),
  languages: i18n.available(),
  language: Settings.get('language') || i18n.detect(app.getLocale()),
}));

handle('window:minimize', () => ctx.win?.minimize());
handle('window:maximize', () => (ctx.win?.isMaximized() ? ctx.win.unmaximize() : ctx.win?.maximize()));
handle('window:close', () => ctx.win?.close());
