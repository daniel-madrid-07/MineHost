/**
 * Helpers more than one IPC module needs.
 *
 * These read the server's own files rather than our settings, because the two
 * can disagree: a folder set up outside the app, or edited by hand, is the
 * authority on what world it uses and where its mods live.
 */
const fs = require('fs');
const path = require('path');

const platforms = require('../platforms');

/**
 * Parses server.properties into a plain object.
 * Minecraft escapes `:` and `=` inside values, so those come back unescaped.
 */
function readProps(serverPath) {
  const file = path.join(serverPath, 'server.properties');
  if (!fs.existsSync(file)) return {};

  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    out[line.slice(0, i)] = line.slice(i + 1).replace(/\\([:=])/g, '$1');
  }
  return out;
}

/**
 * Where this platform keeps its mods or plugins, created if missing.
 * Returns null for platforms that take neither.
 */
function contentDir(settings, info) {
  const platform = platforms.PLATFORMS[info.platform || settings.platform];
  const dir = platform?.modsDir;
  if (!dir) return null;

  const full = path.join(settings.serverPath, dir);
  fs.mkdirSync(full, { recursive: true });
  return full;
}

module.exports = { readProps, contentDir };
