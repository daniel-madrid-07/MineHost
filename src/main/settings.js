const fs = require('fs');
const path = require('path');

let filePath = null;
let cache = {};

const DEFAULTS = {
  serverPath: '',
  platform: 'neoforge',
  minecraft: '',
  build: '',
  javaPath: '',
  ramGb: 4,
  ngrokToken: '',
  autoTunnel: true,
  autoRestartOnCrash: true,
  backupsKeep: 10,
  backupOnStop: true,
  schedule: { restart: { enabled: false, time: '05:00' }, backup: { enabled: false, everyHours: 6 } },
  onboardingDone: false,
  windowBounds: null,
};

function load() {
  try {
    if (fs.existsSync(filePath)) {
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      cache = { ...DEFAULTS, ...saved, schedule: { ...DEFAULTS.schedule, ...(saved.schedule || {}) } };
      return;
    }
  } catch (_) {}
  cache = JSON.parse(JSON.stringify(DEFAULTS));
}

function save() {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), 'utf8');
  } catch (_) {}
}

module.exports = {
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
  merge(patch) {
    cache = { ...cache, ...patch };
    save();
    return this.getAll();
  },
};
