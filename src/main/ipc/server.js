/**
 * Starting, stopping and talking to the running server.
 */

const { ctx, handle, startServer, stopServer } = require('../context');

handle('server:start', () => startServer());
handle('server:stop', () => stopServer());
handle('server:restart', async () => {
  await ctx.server.stop({ save: true });
  return startServer();
});
handle('server:command', (cmd) => ctx.server.sendCommand(cmd));
handle('server:state', () => ctx.server.getState());
handle('server:recentLog', () => ctx.server.getRecentLog());
handle('server:recentEvents', () => ctx.server.getRecentEvents());
