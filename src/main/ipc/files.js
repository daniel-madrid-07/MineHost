/**
 * The in-app file browser.
 */

const { dialog, shell } = require('electron');
const fileManager = require('../fileManager');
const { ctx, handle, currentServer } = require('../context');

const withServer = (fn) => (...args) => {
  const { settings } = currentServer();
  if (!settings) return { ok: false, error: 'NO_SERVER' };
  return fn(settings.serverPath, ...args);
};

handle('files:list', withServer((root, rel) => fileManager.list(root, rel)));
handle('files:read', withServer((root, rel) => fileManager.read(root, rel)));
handle('files:write', withServer((root, { rel, content }) => fileManager.write(root, rel, content)));
handle('files:remove', withServer((root, rel) => fileManager.remove(root, rel)));
handle('files:rename', withServer((root, { rel, name }) => fileManager.rename(root, rel, name)));
handle('files:newFolder', withServer((root, { rel, name }) => fileManager.createFolder(root, rel, name)));
handle('files:upload', withServer((root, { rel, files }) => fileManager.upload(root, rel, files)));
handle('files:reveal', withServer((root, rel) => {
  const target = fileManager.resolveInside(root, rel);
  return target ? shell.openPath(target) : null;
}));

handle('dialog:pickAny', async () => {
  const r = await dialog.showOpenDialog(ctx.win, { properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});
