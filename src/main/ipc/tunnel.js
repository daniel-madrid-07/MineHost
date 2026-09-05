/**
 * The ngrok tunnel and its access token.
 */

const { ctx, send, t, handle, currentServer, patchActive } = require('../context');

handle('ngrok:ensure', () => NgrokManager.ensureBinary((p) => send('task:progress', p)));
handle('ngrok:allowInDefender', () => NgrokManager.addDefenderExclusion());
handle('ngrok:setToken', async (t) => {
  const res = await ctx.tunnel.setAuthToken(t);
  if (res.ok) patchActive({ ngrokToken: t });
  return res;
});
handle('ngrok:start', (port) => {
  const { settings } = currentServer();
  return ctx.tunnel.start(port || settings?.port || 25565);
});
handle('ngrok:stop', () => ctx.tunnel.stop());
handle('ngrok:state', () => ctx.tunnel.getState());
