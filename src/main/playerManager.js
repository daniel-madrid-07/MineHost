const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const FILES = {
  ops: 'ops.json',
  whitelist: 'whitelist.json',
  bans: 'banned-players.json',
  ipBans: 'banned-ips.json',
};

function readList(serverPath, key) {
  const file = path.join(serverPath, FILES[key]);
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

function writeList(serverPath, key, list) {
  fs.mkdirSync(serverPath, { recursive: true });
  fs.writeFileSync(path.join(serverPath, FILES[key]), JSON.stringify(list, null, 2), 'utf8');
}

function dashed(uuid) {
  const h = uuid.replace(/-/g, '');
  if (h.length !== 32) return uuid;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Offline-mode UUID: version 3 over "OfflinePlayer:<name>". */
function offlineUuid(name) {
  const md5 = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  return dashed(md5.toString('hex'));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'MineHost/1.0' } }, (res) => {
      if (res.statusCode === 204 || res.statusCode === 404) {
        res.resume();
        return resolve(null);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.setTimeout(6000, () => req.destroy(new Error('Tiempo de espera agotado')));
  });
}

/** Resolves a name to its Mojang UUID, falling back to the offline UUID. */
async function resolveProfile(name, onlineMode = true) {
  if (onlineMode) {
    try {
      const data = await fetchJson(
        `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`
      );
      if (data && data.id) return { uuid: dashed(data.id), name: data.name, online: true };
      return { error: `No existe ninguna cuenta de Minecraft llamada "${name}".` };
    } catch (err) {
      return { error: `No se pudo consultar a Mojang: ${err.message}` };
    }
  }
  return { uuid: offlineUuid(name), name, online: false };
}

function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = p(Math.floor(Math.abs(off) / 60));
  const om = p(Math.abs(off) % 60);
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ` +
         `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())} ${sign}${oh}${om}`;
}

function readAll(serverPath) {
  return {
    ops: readList(serverPath, 'ops'),
    whitelist: readList(serverPath, 'whitelist'),
    bans: readList(serverPath, 'bans'),
    ipBans: readList(serverPath, 'ipBans'),
  };
}

/**
 * Mutates a player list. While the server runs it owns these files in memory and
 * rewrites them on shutdown, so live changes must go through commands instead.
 */
async function mutate({ serverPath, list, action, value, opts = {}, isRunning, sendCommand }) {
  const name = String(value || '').trim();
  if (!name) return { ok: false, error: 'Escribe un nombre de jugador.' };
  if (list !== 'ipBans' && !/^[A-Za-z0-9_]{1,16}$/.test(name)) {
    return { ok: false, error: 'Nombre de Minecraft no válido (1-16 letras, números o _).' };
  }

  // While the server owns these files it rewrites them on shutdown, so live
  // changes must go through commands. If the console is unreachable — an
  // adopted server, say — fall back to editing the file and tell the caller
  // that a restart is needed for it to take effect.
  if (isRunning) {
    const cmds = {
      ops:       { add: `op ${name}`,             remove: `deop ${name}` },
      whitelist: { add: `whitelist add ${name}`,  remove: `whitelist remove ${name}` },
      bans:      { add: `ban ${name}${opts.reason ? ` ${opts.reason}` : ''}`, remove: `pardon ${name}` },
      ipBans:    { add: `ban-ip ${name}${opts.reason ? ` ${opts.reason}` : ''}`, remove: `pardon-ip ${name}` },
    };

    const sent = sendCommand(cmds[list][action]);
    if (sent && sent.ok !== false) {
      if (list === 'whitelist') sendCommand('whitelist reload');
      return { ok: true, viaCommand: true };
    }
    // Command refused; carry on and write the file directly.
  }

  const current = readList(serverPath, list);

  if (action === 'remove') {
    const key = list === 'ipBans' ? 'ip' : 'name';
    writeList(serverPath, list, current.filter(
      (e) => String(e[key] || '').toLowerCase() !== name.toLowerCase()
    ));
    return { ok: true, needsRestart: isRunning };
  }

  if (list === 'ipBans') {
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(name)) {
      return { ok: false, error: 'Escribe una dirección IP válida (ej. 192.168.1.20).' };
    }
    if (current.some((e) => e.ip === name)) return { ok: false, error: 'Esa IP ya está baneada.' };
    current.push({
      ip: name,
      created: stamp(),
      source: 'MineHost',
      expires: 'forever',
      reason: opts.reason || 'Banned by an operator.',
    });
    writeList(serverPath, list, current);
    return { ok: true, needsRestart: isRunning };
  }

  const profile = await resolveProfile(name, opts.onlineMode !== false);
  if (profile.error) return { ok: false, error: profile.error };

  if (current.some((e) => String(e.name || '').toLowerCase() === profile.name.toLowerCase())) {
    return { ok: false, error: `${profile.name} ya está en la lista.` };
  }

  const entry =
    list === 'ops'
      ? { uuid: profile.uuid, name: profile.name, level: opts.level || 4, bypassesPlayerLimit: false }
      : list === 'whitelist'
      ? { uuid: profile.uuid, name: profile.name }
      : {
          uuid: profile.uuid,
          name: profile.name,
          created: stamp(),
          source: 'MineHost',
          expires: 'forever',
          reason: opts.reason || 'Banned by an operator.',
        };

  current.push(entry);
  writeList(serverPath, list, current);
  return { ok: true, resolved: profile, needsRestart: isRunning };
}

module.exports = { readAll, readList, mutate, resolveProfile, offlineUuid };
