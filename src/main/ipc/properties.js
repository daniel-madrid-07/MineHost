/**
 * Reading and writing server.properties.
 */

const path = require('path');
const fs = require('fs');
const { ctx, handle } = require('../context');

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

handle('props:read', (p) => readProps(p));

handle('props:write', ({ serverPath, values }) => {
  const file = path.join(serverPath, 'server.properties');
  const seen = new Set();
  let lines = [];

  if (fs.existsSync(file)) {
    lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((raw) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return raw;
      const i = line.indexOf('=');
      if (i === -1) return raw;
      const key = line.slice(0, i);
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        seen.add(key);
        return `${key}=${String(values[key])}`;
      }
      return raw;
    });
  }
  for (const [k, v] of Object.entries(values)) {
    if (!seen.has(k)) lines.push(`${k}=${String(v)}`);
  }

  fs.mkdirSync(serverPath, { recursive: true });
  fs.writeFileSync(file, lines.filter((l, i, a) => l !== '' || i < a.length - 1).join('\n'), 'utf8');
  return { ok: true };
});
