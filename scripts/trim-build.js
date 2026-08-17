/**
 * Drops Electron payload the app never uses.
 *
 * Only two things are removed, both provably safe:
 *   - Chromium locale packs for languages MineHost is not translated into.
 *     These only affect Chromium's own built-in UI (context menus, error
 *     pages); our strings live in src/i18n and are unaffected.
 *   - The bundled Chromium licence dump, which is kept next to the installer
 *     instead of shipping inside every install.
 *
 * The graphics DLLs (libGLESv2, vk_swiftshader, d3dcompiler_47, vulkan-1) look
 * like easy wins but are not: Chromium falls back to them for software
 * rendering, and removing them gives black windows on machines with old or
 * missing GPU drivers.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UNPACKED = path.join(ROOT, 'release', 'win-unpacked');

/** Locales matching the languages in src/i18n, plus Chromium's own fallback. */
const KEEP_LOCALES = new Set([
  'en-US', 'en-GB', 'es', 'es-419', 'pt-BR', 'pt-PT', 'fr', 'de', 'it', 'ru',
]);

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

function trimLocales() {
  const dir = path.join(UNPACKED, 'locales');
  if (!fs.existsSync(dir)) return 0;

  let freed = 0;
  let removed = 0;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.pak')) continue;
    if (KEEP_LOCALES.has(path.basename(file, '.pak'))) continue;

    const full = path.join(dir, file);
    freed += fs.statSync(full).size;
    fs.rmSync(full);
    removed++;
  }
  console.log(`trim-build: removed ${removed} unused locale packs (${mb(freed)})`);
  return freed;
}

/** Keeps the licence file with the release rather than inside the install. */
function moveLicences() {
  const src = path.join(UNPACKED, 'LICENSES.chromium.html');
  if (!fs.existsSync(src)) return 0;

  const size = fs.statSync(src).size;
  const dest = path.join(ROOT, 'release', 'LICENSES.chromium.html');
  fs.renameSync(src, dest);
  console.log(`trim-build: moved Chromium licences beside the installer (${mb(size)})`);
  return size;
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size;
  }
  return total;
}

function main() {
  if (!fs.existsSync(UNPACKED)) {
    console.error('trim-build: release/win-unpacked not found; package first.');
    process.exit(1);
  }

  const before = dirSize(UNPACKED);
  trimLocales();
  moveLicences();
  const after = dirSize(UNPACKED);

  console.log(`trim-build: ${mb(before)} -> ${mb(after)} (saved ${mb(before - after)})`);
}

main();
