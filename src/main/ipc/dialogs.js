/**
 * Native file and folder pickers.
 */

const { dialog, shell } = require('electron');
const { ctx, handle } = require('../context');

handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(ctx.win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

handle('dialog:pickJars', async () => {
  const r = await dialog.showOpenDialog(ctx.win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Mods y plugins', extensions: ['jar'] }],
  });
  return r.canceled ? [] : r.filePaths;
});

handle('dialog:pickZip', async () => {
  const r = await dialog.showOpenDialog(ctx.win, {
    properties: ['openFile'],
    filters: [{ name: 'Mundo comprimido', extensions: ['zip'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

handle('dialog:saveZip', async (defaultName) => {
  const r = await dialog.showSaveDialog(ctx.win, {
    defaultPath: defaultName,
    filters: [{ name: 'Archivo ZIP', extensions: ['zip'] }],
  });
  return r.canceled ? null : r.filePath;
});

handle('shell:openPath', (p) => shell.openPath(p));
handle('shell:openExternal', (url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});
