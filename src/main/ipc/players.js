/**
 * Operators, whitelist, bans and kicks.
 */

const players = require('../playerManager');
const { ctx, handle, currentServer } = require('../context');
const { readProps } = require('./shared');

handle('players:read', (p) => players.readAll(p));
handle('players:mutate', async ({ list, action, value, opts }) => {
  const { settings } = currentServer();
  const props = readProps(settings.serverPath);
  return players.mutate({
    serverPath: settings.serverPath,
    list, action, value,
    opts: { ...opts, onlineMode: props['online-mode'] !== 'false' },
    isRunning: ctx.server.getState().status === 'running',
    sendCommand: (c) => ctx.server.sendCommand(c),
  });
});
handle('players:kick', ({ name, reason }) =>
  ctx.server.sendCommand(`kick ${name}${reason ? ` ${reason}` : ''}`));
