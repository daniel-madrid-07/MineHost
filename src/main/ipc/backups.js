/**
 * Creating, restoring and pruning world backups.
 */

const { shell } = require('electron');
const backups = require('../backupManager');
const { ctx, handle, currentServer, createBackup } = require('../context');

handle('backups:list', (p) => backups.list(p));
handle('backups:create', (label) => createBackup({ label }));
handle('backups:restore', async (file) => {
  const { settings, info } = currentServer();
  return backups.restore({
    serverPath: settings.serverPath,
    file,
    levelName: info.levelName || 'world',
    isRunning: ctx.server.getState().status !== 'stopped',
  });
});
handle('backups:remove', (file) => {
  const { settings } = currentServer();
  return backups.remove(settings.serverPath, file);
});
handle('backups:openFolder', () => {
  const { settings } = currentServer();
  return shell.openPath(backups.backupsDir(settings.serverPath));
});
