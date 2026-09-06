/**
 * Datapacks for the active world.
 */

const path = require('path');
const fs = require('fs');
const { handle, currentServer } = require('../context');
const { readProps } = require('./shared');

handle('datapacks:list', () => {
  const { settings } = currentServer();
  const props = readProps(settings.serverPath);
  const dir = path.join(settings.serverPath, props['level-name'] || 'world', 'datapacks');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((f) => {
    const st = fs.statSync(path.join(dir, f));
    return { name: f, size: st.isDirectory() ? 0 : st.size, isFolder: st.isDirectory() };
  });
});

handle('datapacks:add', (files) => {
  const { settings } = currentServer();
  const props = readProps(settings.serverPath);
  const dir = path.join(settings.serverPath, props['level-name'] || 'world', 'datapacks');
  fs.mkdirSync(dir, { recursive: true });
  let added = 0;
  for (const src of files) {
    if (!src.toLowerCase().endsWith('.zip')) continue;
    fs.copyFileSync(src, path.join(dir, path.basename(src)));
    added++;
  }
  return { ok: true, added };
});

handle('datapacks:remove', (name) => {
  const { settings } = currentServer();
  const props = readProps(settings.serverPath);
  const target = path.join(settings.serverPath, props['level-name'] || 'world', 'datapacks', name);
  fs.rmSync(target, { recursive: true, force: true });
  return { ok: true };
});
