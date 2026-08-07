const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const { dirSize } = require('./backupManager');

/** A folder is a world if it carries a level.dat. */
function isWorld(dir) {
  return fs.existsSync(path.join(dir, 'level.dat'));
}

function list(serverPath, activeName = 'world') {
  if (!fs.existsSync(serverPath)) return [];
  const out = [];

  for (const entry of fs.readdirSync(serverPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(serverPath, entry.name);
    if (!isWorld(full)) continue;
    // Nether/End live beside the overworld on Paper-likes; not separate worlds.
    if (/_nether$|_the_end$/.test(entry.name)) continue;
    // Copies we set aside during a restore or delete are not offered as worlds.
    if (/_anterior_[\d-]+$/.test(entry.name) || entry.name.startsWith('_papelera_')) continue;

    let modified = 0;
    try { modified = fs.statSync(path.join(full, 'level.dat')).mtimeMs; } catch (_) {}

    out.push({
      name: entry.name,
      active: entry.name === activeName,
      size: dirSize(full),
      modified,
      hasNether: fs.existsSync(path.join(serverPath, `${entry.name}_nether`))
        || fs.existsSync(path.join(full, 'DIM-1')),
      hasEnd: fs.existsSync(path.join(serverPath, `${entry.name}_the_end`))
        || fs.existsSync(path.join(full, 'DIM1')),
    });
  }

  return out.sort((a, b) => Number(b.active) - Number(a.active) || b.modified - a.modified);
}

function related(serverPath, name) {
  return [name, `${name}_nether`, `${name}_the_end`]
    .map((n) => path.join(serverPath, n))
    .filter((p) => fs.existsSync(p));
}

function validName(name) {
  return /^[\w\-. ]{1,48}$/.test(name) && !/^\.+$/.test(name);
}

function rename(serverPath, from, to) {
  if (!validName(to)) return { ok: false, error: 'Nombre no válido para un mundo.' };
  if (fs.existsSync(path.join(serverPath, to))) {
    return { ok: false, error: `Ya existe un mundo llamado "${to}".` };
  }
  for (const dir of related(serverPath, from)) {
    const suffix = path.basename(dir).slice(from.length);
    fs.renameSync(dir, path.join(serverPath, to + suffix));
  }
  return { ok: true };
}

/** Moves a world aside rather than deleting it outright. */
function remove(serverPath, name, activeName) {
  if (name === activeName) {
    return { ok: false, error: 'No puedes borrar el mundo activo. Cambia a otro primero.' };
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const moved = [];
  for (const dir of related(serverPath, name)) {
    const to = path.join(serverPath, `_papelera_${path.basename(dir)}_${stamp}`);
    fs.renameSync(dir, to);
    moved.push(path.basename(to));
  }
  return { ok: true, moved };
}

/** Deletes the dimension folders so they regenerate on next start. */
function resetDimension(serverPath, worldName, dimension) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const targets = dimension === 'nether'
    ? [path.join(serverPath, `${worldName}_nether`), path.join(serverPath, worldName, 'DIM-1')]
    : [path.join(serverPath, `${worldName}_the_end`), path.join(serverPath, worldName, 'DIM1')];

  const moved = [];
  for (const dir of targets) {
    if (!fs.existsSync(dir)) continue;
    const to = `${dir}_anterior_${stamp}`;
    fs.renameSync(dir, to);
    moved.push(path.basename(to));
  }
  if (!moved.length) {
    return { ok: false, error: 'Esa dimensión aún no se ha generado, no hay nada que reiniciar.' };
  }
  return { ok: true, moved };
}

async function exportWorld({ serverPath, name, dest, onProgress }) {
  const dirs = related(serverPath, name);
  if (!dirs.length) return { ok: false, error: 'Ese mundo ya no existe.' };

  const zip = new AdmZip();
  let done = 0;
  for (const dir of dirs) {
    onProgress?.({
      label: `Comprimiendo ${path.basename(dir)}…`,
      percent: Math.round((done / dirs.length) * 90),
    });
    zip.addLocalFolder(dir, path.basename(dir));
    done++;
  }

  onProgress?.({ label: 'Guardando el archivo…', percent: 95 });
  await zip.writeZipPromise(dest);

  return { ok: true, file: dest };
}

/**
 * Imports a world zip. Handles both shapes: a zip whose root *is* the world,
 * and one that wraps it in a folder.
 */
function importWorld({ serverPath, zipPath, name }) {
  if (!validName(name)) return { ok: false, error: 'Nombre no válido para un mundo.' };
  if (fs.existsSync(path.join(serverPath, name))) {
    return { ok: false, error: `Ya existe un mundo llamado "${name}".` };
  }

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  const levelEntry = entries.find((e) => e.entryName.replace(/\\/g, '/').endsWith('level.dat'));
  if (!levelEntry) {
    return { ok: false, error: 'Ese .zip no contiene un mundo (no se encuentra level.dat).' };
  }

  const prefix = levelEntry.entryName.replace(/\\/g, '/').replace(/level\.dat$/, '');
  const target = path.join(serverPath, name);
  fs.mkdirSync(target, { recursive: true });

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const rel = entry.entryName.replace(/\\/g, '/');
    if (prefix && !rel.startsWith(prefix)) continue;

    const relative = prefix ? rel.slice(prefix.length) : rel;
    if (!relative || relative.startsWith('..')) continue;

    const out = path.join(target, relative);
    if (!path.resolve(out).startsWith(path.resolve(target))) continue; // zip-slip guard

    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, entry.getData());
  }

  return { ok: true, name };
}

module.exports = { list, rename, remove, resetDimension, exportWorld, importWorld, isWorld, validName };
