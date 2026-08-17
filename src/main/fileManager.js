const fs = require('fs');
const path = require('path');

/** Text-ish files the built-in editor will open. */
const EDITABLE = new Set([
  '.txt', '.json', '.json5', '.properties', '.yml', '.yaml', '.toml', '.cfg',
  '.conf', '.ini', '.log', '.md', '.mcmeta', '.snbt', '.csv', '.xml', '.sh', '.bat',
]);

const MAX_EDIT_BYTES = 2 * 1024 * 1024;

/** Directories that only ever hold machine-generated bulk. */
const HIDDEN = new Set(['libraries', 'versions', 'cache', '.minehost', 'natives']);

/**
 * Resolves a path inside the server folder, refusing anything that escapes it.
 * Every path from the renderer goes through here.
 */
function resolveInside(serverPath, relative = '') {
  const root = path.resolve(serverPath);
  const target = path.resolve(root, relative || '.');
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

function list(serverPath, relative = '') {
  const dir = resolveInside(serverPath, relative);
  if (!dir || !fs.existsSync(dir)) return { ok: false, error: 'NOT_FOUND' };

  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) return { ok: false, error: 'NOT_A_FOLDER' };

  const entries = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (HIDDEN.has(entry.name)) continue;

    const full = path.join(dir, entry.name);
    let size = 0;
    let modified = 0;
    try {
      const st = fs.statSync(full);
      size = st.size;
      modified = st.mtimeMs;
    } catch (_) {
      continue;
    }

    entries.push({
      name: entry.name,
      isFolder: entry.isDirectory(),
      size,
      modified,
      editable: !entry.isDirectory()
        && EDITABLE.has(path.extname(entry.name).toLowerCase())
        && size <= MAX_EDIT_BYTES,
    });
  }

  entries.sort((a, b) =>
    Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name, undefined, { numeric: true }));

  return {
    ok: true,
    path: relative.replace(/\\/g, '/'),
    parent: relative ? path.dirname(relative).replace(/^\.$/, '').replace(/\\/g, '/') : null,
    entries,
  };
}

function read(serverPath, relative) {
  const file = resolveInside(serverPath, relative);
  if (!file || !fs.existsSync(file)) return { ok: false, error: 'NOT_FOUND' };

  const stat = fs.statSync(file);
  if (stat.isDirectory()) return { ok: false, error: 'NOT_A_FILE' };
  if (stat.size > MAX_EDIT_BYTES) return { ok: false, error: 'TOO_BIG' };
  if (!EDITABLE.has(path.extname(file).toLowerCase())) return { ok: false, error: 'NOT_EDITABLE' };

  const buffer = fs.readFileSync(file);
  // A NUL byte means this is not really text, whatever the extension claims.
  if (buffer.includes(0)) return { ok: false, error: 'NOT_EDITABLE' };

  return { ok: true, content: buffer.toString('utf8'), size: stat.size };
}

function write(serverPath, relative, content) {
  const file = resolveInside(serverPath, relative);
  if (!file) return { ok: false, error: 'NOT_FOUND' };
  if (!EDITABLE.has(path.extname(file).toLowerCase())) return { ok: false, error: 'NOT_EDITABLE' };

  // Keep one rollback copy: config edits are easy to get wrong.
  if (fs.existsSync(file)) {
    try { fs.copyFileSync(file, `${file}.bak`); } catch (_) {}
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return { ok: true };
}

/** Moves to a recycle folder rather than deleting outright. */
function remove(serverPath, relative) {
  const target = resolveInside(serverPath, relative);
  if (!target || !fs.existsSync(target)) return { ok: false, error: 'NOT_FOUND' };
  if (path.resolve(target) === path.resolve(serverPath)) return { ok: false, error: 'NOT_FOUND' };

  const bin = path.join(serverPath, '.minehost', 'trash');
  fs.mkdirSync(bin, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  fs.renameSync(target, path.join(bin, `${path.basename(target)}_${stamp}`));
  return { ok: true };
}

function rename(serverPath, relative, newName) {
  if (!/^[^\\/:*?"<>|]{1,120}$/.test(newName)) return { ok: false, error: 'BAD_NAME' };

  const from = resolveInside(serverPath, relative);
  if (!from || !fs.existsSync(from)) return { ok: false, error: 'NOT_FOUND' };

  const to = path.join(path.dirname(from), newName);
  if (!resolveInside(serverPath, path.relative(serverPath, to))) return { ok: false, error: 'NOT_FOUND' };
  if (fs.existsSync(to)) return { ok: false, error: 'EXISTS' };

  fs.renameSync(from, to);
  return { ok: true };
}

function createFolder(serverPath, relative, name) {
  if (!/^[^\\/:*?"<>|]{1,120}$/.test(name)) return { ok: false, error: 'BAD_NAME' };

  const dir = resolveInside(serverPath, path.join(relative || '', name));
  if (!dir) return { ok: false, error: 'NOT_FOUND' };
  if (fs.existsSync(dir)) return { ok: false, error: 'EXISTS' };

  fs.mkdirSync(dir, { recursive: true });
  return { ok: true };
}

function upload(serverPath, relative, sources) {
  const dir = resolveInside(serverPath, relative);
  if (!dir) return { ok: false, error: 'NOT_FOUND' };
  fs.mkdirSync(dir, { recursive: true });

  let added = 0;
  for (const src of sources) {
    try {
      fs.copyFileSync(src, path.join(dir, path.basename(src)));
      added++;
    } catch (_) {}
  }
  return { ok: true, added };
}

module.exports = { list, read, write, remove, rename, createFolder, upload, resolveInside, EDITABLE };
