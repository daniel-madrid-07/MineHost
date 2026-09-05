/**
 * Downloading and installing server platforms.
 */

const Settings = require('../settings');
const Installer = require('../installer');
const platforms = require('../platforms');
const { send, handle } = require('../context');

handle('platform:versions', (id) => platforms.listVersions(id));
handle('installer:status', (p) => Installer.inspectServer(p));
handle('installer:javaFor', (mc) => Installer.requiredJava(mc));

handle('installer:install', async ({ serverId, serverPath, platformId, minecraft, build }) => {
  const res = await Installer.installServer({
    serverPath, platformId, minecraft, build,
    onProgress: (p) => send('task:progress', p),
  });
  const id = serverId || Settings.get('activeServerId');
  if (id) {
    Settings.updateServer(id, {
      serverPath, platform: platformId, minecraft,
      build: res.build, javaPath: res.javaPath,
    });
  }
  return res;
});
