/**
 * Application-wide preferences.
 */

const Settings = require('../settings');
const { handle } = require('../context');

handle('settings:get', () => Settings.getAll());

handle('settings:set', (patch) => {
  const next = Settings.merge(patch);
  return next;
});
