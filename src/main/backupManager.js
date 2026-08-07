const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

/* Regenerable or huge; never worth carrying in a backup. */
const SKIP_DIRS = new Set([
  'logs', 'crash-reports', 'cache', 'libraries', 'versions',
  'backups', '.minehost', 'run', 'downloads',
]);

const EXTRA_FILES = [
  'server.properties', 'ops.json', 'whitelist.json',
  'banned-players.json', 'banned-ips.json', 'usercache.json',
  'eula.txt', 'server-icon.png',
];

function backupsDir(serverPath) {
  const dir = path.join(serverPath, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function dirSize(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else { try { total += fs.statSync(full).size; } catch (_) {} }
  }
  return total;
}

function worldFolders(serverPath, levelName = 'world') {
  const out = [];
  for (const name of [levelName, `${levelName}_nether`, `${levelName}_the_end`]) {
    if (fs.existsSync(path.join(serverPath, name))) out.push(name);
  }
  return out;
}

function list(serverPath) {
  const dir = backupsDir(serverPath);
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.zip'))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { file: f, size: st.size, created: st.mtimeMs };
    })
    .sort((a, b) => b.created - a.created);
}

function prune(serverPath, keep) {
  if (!keep || keep < 1) return 0;
  const all = list(serverPath);
  let removed = 0;
  for (const b of all.slice(keep)) {
    try { fs.unlinkSync(path.join(backupsDir(serverPath), b.file)); removed++; } catch (_) {}
  }
  return removed;
}

/**
 * Creates a backup. When the server is live it must be told to flush the world
 * first: copying region files mid-write produces a corrupt backup.
 */
async function create({
  serverPath, levelName = 'world', label = '', keep = 10,
  isRunning, sendCommand, waitForSave, onProgress,
}) {
  if (!fs.existsSync(serverPath)) return { ok: false, error: 'La carpeta del servidor no existe.' };

  const worlds = worldFolders(serverPath, levelName);
  if (!worlds.length) return { ok: false, error: 'No hay ningún mundo que copiar todavía.' };

  let resumed = false;
  if (isRunning) {
    onProgress?.({ label: 'Pausando el guardado del mundo…', percent: 5 });
    sendCommand('save-off');
    sendCommand('save-all flush');
    await waitForSave();
    resumed = true;
  }

  const safeLabel = label.trim().replace(/[^\w\-]+/g, '_').slice(0, 40);
  const name = `backup_${timestamp()}${safeLabel ? `_${safeLabel}` : ''}.zip`;
  const dest = path.join(backupsDir(serverPath), name);

  try {
    const zip = new AdmZip();

    const folders = [
      ...worlds.map((w) => [path.join(serverPath, w), w]),
      ...['mods', 'config', 'plugins', 'datapacks']
        .filter((d) => !SKIP_DIRS.has(d) && fs.existsSync(path.join(serverPath, d)))
        .map((d) => [path.join(serverPath, d), d]),
    ];

    let done = 0;
    for (const [absolute, name] of folders) {
      onProgress?.({
        label: `Comprimiendo ${name}…`,
        percent: 5 + Math.round((done / folders.length) * 88),
      });
      zip.addLocalFolder(absolute, name);
      done++;
    }

    for (const f of EXTRA_FILES) {
      const file = path.join(serverPath, f);
      if (fs.existsSync(file)) zip.addLocalFile(file);
    }

    zip.addFile(
      'minehost-backup.json',
      Buffer.from(JSON.stringify({ createdAt: new Date().toISOString(), levelName, worlds, label }, null, 2))
    );

    onProgress?.({ label: 'Guardando el archivo…', percent: 95 });
    await zip.writeZipPromise(dest);
  } catch (err) {
    try { fs.unlinkSync(dest); } catch (_) {}
    if (resumed) sendCommand('save-on');
    return { ok: false, error: `No se pudo crear la copia: ${err.message}` };
  }

  if (resumed) sendCommand('save-on');

  const pruned = prune(serverPath, keep);
  onProgress?.({ label: 'Copia creada', percent: 100 });

  return { ok: true, file: name, size: fs.statSync(dest).size, pruned };
}

/** Restores a backup. The current world is moved aside, never deleted. */
async function restore({ serverPath, file, levelName = 'world', isRunning }) {
  if (isRunning) {
    return { ok: false, error: 'Apaga el servidor antes de restaurar una copia.' };
  }
  const src = path.join(backupsDir(serverPath), file);
  if (!fs.existsSync(src)) return { ok: false, error: 'Esa copia ya no existe.' };

  const stampSuffix = timestamp();
  const movedAside = [];

  try {
    for (const w of worldFolders(serverPath, levelName)) {
      const from = path.join(serverPath, w);
      const to = path.join(serverPath, `${w}_anterior_${stampSuffix}`);
      fs.renameSync(from, to);
      movedAside.push({ from, to });
    }

    new AdmZip(src).extractAllTo(serverPath, true);
    return { ok: true, movedAside: movedAside.map((m) => path.basename(m.to)) };
  } catch (err) {
    for (const m of movedAside) {
      try {
        if (fs.existsSync(m.from)) fs.rmSync(m.from, { recursive: true, force: true });
        fs.renameSync(m.to, m.from);
      } catch (_) {}
    }
    return { ok: false, error: `No se pudo restaurar: ${err.message}` };
  }
}

function remove(serverPath, file) {
  const target = path.join(backupsDir(serverPath), path.basename(file));
  if (fs.existsSync(target)) fs.unlinkSync(target);
  return { ok: true };
}

module.exports = { list, create, restore, remove, backupsDir, worldFolders, dirSize };
