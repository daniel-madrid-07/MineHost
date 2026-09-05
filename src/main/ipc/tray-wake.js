/**
 * Tray behaviour, launch-at-login and wake-on-demand.
 */

const { app } = require('electron');
const Settings = require('../settings');
const updater = require('../updater');
const { setAutoLaunch, getAutoLaunch } = require('../tray');
const { ctx, handle, armWake } = require('../context');

handle('app:tray', (enabled) => {
  Settings.merge({ minimiseToTray: enabled });
  if (enabled) ctx.tray.create();
  else ctx.tray.destroy();
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
  else await ctx.wake.stop();
  return { ok: true, listening: ctx.wake.listening };
});

handle('app:wakeState', () => ({
  enabled: !!Settings.get('wakeOnDemand'),
  idleMinutes: Settings.get('wakeIdleMinutes') || 10,
  listening: ctx.wake?.listening || false,
}));

handle('server:history', () => ctx.server.getHistory());

handle('app:checkUpdate', async () => {
  const res = await updater.check(app.getVersion());
  Settings.merge({ lastUpdateCheck: Date.now() });
  return res;
});
