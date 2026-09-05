/**
 * Creating, selecting and editing the managed servers.
 */

const Settings = require('../settings');
const Installer = require('../installer');
const { ctx, handle, currentServer, armWake } = require('../context');

handle('servers:list', () => Settings.listServers().map((s) => {
  const info = Installer.inspectServer(s.serverPath);
  return { ...s, installed: info.installed, minecraft: info.minecraft || s.minecraft };
}));

handle('servers:active', () => {
  const { settings, info } = currentServer();
  return settings ? { ...settings, installed: info.installed } : null;
});

handle('servers:add', (patch) => Settings.addServer(patch));

handle('servers:update', ({ id, patch }) => {
  const next = Settings.updateServer(id, patch);
  if (next && id === Settings.get('activeServerId') && patch.schedule) {
    ctx.scheduler.configure(next.schedule);
  }
  return next;
});

handle('servers:remove', async (id) => {
  if (id === Settings.get('activeServerId') && ctx.server.getState().status !== 'stopped') {
    return { ok: false, error: 'SERVER_RUNNING' };
  }
  Settings.removeServer(id);
  return { ok: true, servers: Settings.listServers() };
});

handle('servers:select', async (id) => {
  if (ctx.server.getState().status !== 'stopped') return { ok: false, error: 'SERVER_RUNNING' };
  await ctx.tunnel.stop();
  const next = Settings.setActive(id);
  ctx.scheduler.configure(next?.schedule || {});
  await ctx.wake.stop();
  ctx.server.releaseExternal();

  const state = await ctx.server.adoptExisting({
    serverPath: next?.serverPath,
    port: next?.port || 25565,
  });
  if (!state.external && Settings.get('wakeOnDemand')) await armWake();

  ctx.tray?.refresh();
  return { ok: true, server: next };
});
