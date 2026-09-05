/**
 * Game rules, applied live when the server is up.
 */

const { ctx, handle } = require('../context');

handle('gamerules:set', ({ key, value }) => {
  if (ctx.server.getState().status !== 'running') {
    return { ok: false, error: 'START_FOR_GAMERULES' };
  }
  return ctx.server.sendCommand(`gamerule ${key} ${value}`);
});
