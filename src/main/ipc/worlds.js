/**
 * Worlds: switching, importing, exporting and resetting.
 */

const path = require('path');
const fs = require('fs');
const worlds = require('../worldManager');
const { ctx, send, handle, currentServer } = require('../context');

handle('worlds:list', () => {
  const { settings } = currentServer();
  const props = readProps(settings.serverPath);
  return worlds.list(settings.serverPath, props['level-name'] || 'world');
});

handle('worlds:activate', (name) => {
  if (ctx.server.getState().status !== 'stopped') {
    return { ok: false, error: 'STOP_BEFORE_SWITCH_WORLD' };
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
  if (ctx.server.getState().status !== 'stopped') {
    return { ok: false, error: 'STOP_BEFORE_RENAME_WORLD' };
  }
  const { settings } = currentServer();
  return worlds.rename(settings.serverPath, from, to);
});

handle('worlds:remove', (name) => {
  if (ctx.server.getState().status !== 'stopped') {
    return { ok: false, error: 'STOP_BEFORE_DELETE_WORLD' };
  }
  const { settings } = currentServer();
  const props = readProps(settings.serverPath);
  return worlds.remove(settings.serverPath, name, props['level-name'] || 'world');
});

handle('worlds:resetDimension', ({ world, dimension }) => {
  if (ctx.server.getState().status !== 'stopped') {
    return { ok: false, error: 'STOP_BEFORE_RESET_DIM' };
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
  if (ctx.server.getState().status !== 'stopped') {
    return { ok: false, error: 'STOP_BEFORE_IMPORT_WORLD' };
  }
  const { settings } = currentServer();
  return worlds.importWorld({ serverPath: settings.serverPath, zipPath, name });
});
