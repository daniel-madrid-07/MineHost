/**
 * Local mod and plugin files.
 */

const { shell } = require('electron');
const path = require('path');
const fs = require('fs');
const platforms = require('../platforms');
const { handle, currentServer } = require('../context');
const { contentDir } = require('./shared');

handle('mods:list', () => {
  const { settings, info } = currentServer();
  const dir = contentDir(settings, info);
  if (!dir) return { supported: false, items: [] };

  const items = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jar') || f.endsWith('.jar.disabled'))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return {
        file: f,
        name: f.replace(/\.disabled$/, ''),
        enabled: !f.endsWith('.disabled'),
        size: st.size,
        added: st.mtimeMs,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const platform = platforms.PLATFORMS[info.platform || settings.platform];
  return { supported: true, items, kind: platform?.kind, dirName: platform?.modsDir };
});

handle('mods:add', (files) => {
  const { settings, info } = currentServer();
  const dir = contentDir(settings, info);
  if (!dir) return { ok: false, error: 'PLATFORM_NO_MODS' };
  let added = 0;
  for (const src of files) {
    if (!src.toLowerCase().endsWith('.jar')) continue;
    fs.copyFileSync(src, path.join(dir, path.basename(src)));
    added++;
  }
  return { ok: true, added };
});

handle('mods:toggle', (file) => {
  const { settings, info } = currentServer();
  const dir = contentDir(settings, info);
  const from = path.join(dir, file);
  const to = file.endsWith('.disabled')
    ? path.join(dir, file.replace(/\.disabled$/, ''))
    : `${from}.disabled`;
  fs.renameSync(from, to);
  return { ok: true };
});

handle('mods:remove', (file) => {
  const { settings, info } = currentServer();
  fs.unlinkSync(path.join(contentDir(settings, info), file));
  return { ok: true };
});

handle('mods:openFolder', () => {
  const { settings, info } = currentServer();
  const dir = contentDir(settings, info);
  return dir ? shell.openPath(dir) : null;
});
