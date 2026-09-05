/**
 * Scheduled restarts and automatic backups.
 */

const Settings = require('../settings');
const { ctx, handle } = require('../context');

handle('schedule:get', () => ctx.scheduler.getConfig());
handle('schedule:set', (config) => {
  Settings.merge({ schedule: config });
  return ctx.scheduler.configure(config);
});
