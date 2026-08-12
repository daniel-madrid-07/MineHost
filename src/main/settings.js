const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let filePath = null;
let cache = {};

const APP_DEFAULTS = {
  language: 'en',
  servers: [],
  activeServerId: null,
  onboardingDone: false,
  windowBounds: null,
  lastUpdateCheck: 0,
};

/** A server entry. `exposure` decides between the tunnel and port forwarding. */
const SERVER_DEFAULTS = {
  name: '',
  serverPath: '',
  platform: 'neoforge',
  minecraft: '',
  build: '',
  javaPath: '',
  ramGb: 4,
  port: 25565,
  exposure: 'tunnel',        // 'tunnel' | 'portforward' | 'lan'
  ngrokToken: '',
  autoTunnel: true,
  autoRestartOnCrash: true,
  backupsKeep: 10,
  backupOnStop: true,
  schedule: {
    restart: { enabled: false, time: '05:00' },
    backup: { enabled: false, everyHours: 6 },
  },
};

const newId = () => crypto.randomBytes(8).toString('hex');

/**
 * Older builds stored a single server at the root of the config. Fold that into
 * the servers list so nobody has to set their server up again.
 */
function migrate(saved) {
  if (Array.isArray(saved.servers)) return saved;

  const next = {
    ...APP_DEFAULTS,
    language: saved.language || 'en',
    onboardingDone: !!saved.onboardingDone,
    windowBounds: saved.windowBounds || null,
    servers: [],
    activeServerId: null,
  };

  if (saved.serverPath) {
    const id = newId();
    next.servers.push({
      ...SERVER_DEFAULTS,
      id,
      name: path.basename(saved.serverPath) || 'Mi servidor',
      serverPath: saved.serverPath,
      platform: saved.platform || 'neoforge',
      minecraft: saved.minecraft || '',
      build: saved.build || '',
      javaPath: saved.javaPath || '',
      ramGb: saved.ramGb || 4,
      ngrokToken: saved.ngrokToken || '',
      autoTunnel: saved.autoTunnel !== false,
      autoRestartOnCrash: saved.autoRestartOnCrash !== false,
      backupsKeep: saved.backupsKeep || 10,
      backupOnStop: saved.backupOnStop !== false,
      exposure: saved.ngrokToken ? 'tunnel' : 'tunnel',
      schedule: { ...SERVER_DEFAULTS.schedule, ...(saved.schedule || {}) },
    });
    next.activeServerId = id;
  }

  return next;
}

function load() {
  try {
    if (fs.existsSync(filePath)) {
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      cache = { ...APP_DEFAULTS, ...migrate(saved) };
      cache.servers = cache.servers.map((s) => ({
        ...SERVER_DEFAULTS,
        ...s,
        schedule: { ...SERVER_DEFAULTS.schedule, ...(s.schedule || {}) },
      }));
      if (!cache.servers.some((s) => s.id === cache.activeServerId)) {
        cache.activeServerId = cache.servers[0]?.id || null;
      }
      return;
    }
  } catch (_) {}
  cache = JSON.parse(JSON.stringify(APP_DEFAULTS));
}

function save() {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), 'utf8');
  } catch (_) {}
}

const api = {
  init(userDataDir) {
    filePath = path.join(userDataDir, 'minehost-config.json');
    load();
  },

  getAll() {
    return JSON.parse(JSON.stringify(cache));
  },

  get(key) {
    return cache[key];
  },

  /** App-level values only; server fields live on each entry. */
  merge(patch) {
    cache = { ...cache, ...patch };
    save();
    return api.getAll();
  },

  listServers() {
    return JSON.parse(JSON.stringify(cache.servers));
  },

  activeServer() {
    const found = cache.servers.find((s) => s.id === cache.activeServerId);
    return found ? JSON.parse(JSON.stringify(found)) : null;
  },

  addServer(patch = {}) {
    const entry = { ...SERVER_DEFAULTS, ...patch, id: newId() };
    if (!entry.name) entry.name = `Servidor ${cache.servers.length + 1}`;
    cache.servers.push(entry);
    cache.activeServerId = entry.id;
    save();
    return JSON.parse(JSON.stringify(entry));
  },

  updateServer(id, patch) {
    const i = cache.servers.findIndex((s) => s.id === id);
    if (i === -1) return null;
    cache.servers[i] = {
      ...cache.servers[i],
      ...patch,
      schedule: { ...cache.servers[i].schedule, ...(patch.schedule || {}) },
      id,
    };
    save();
    return JSON.parse(JSON.stringify(cache.servers[i]));
  },

  removeServer(id) {
    cache.servers = cache.servers.filter((s) => s.id !== id);
    if (cache.activeServerId === id) cache.activeServerId = cache.servers[0]?.id || null;
    save();
    return api.getAll();
  },

  setActive(id) {
    if (cache.servers.some((s) => s.id === id)) {
      cache.activeServerId = id;
      save();
    }
    return api.activeServer();
  },
};

module.exports = api;
module.exports.SERVER_DEFAULTS = SERVER_DEFAULTS;
