const fs = require('fs');
const path = require('path');

let filePath = null;
let cache = {};

const DEFAULTS = {
  serverPath: '',
  neoforgeVersion: '',
  javaPath: '',
  ramGb: 4,
  ngrokToken: '',
  autoTunnel: true,
};

function load() {
  try {
    if (fs.existsSync(filePath)) {
      cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(filePath, 'utf8')) };
      return;
    }
  } catch (_) {}
  cache = { ...DEFAULTS };
}

function save() {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), 'utf8');
}

module.exports = {
  init(userDataDir) {
    filePath = path.join(userDataDir, 'minehost-config.json');
    load();
  },
  getAll() {
    return { ...cache };
  },
  merge(patch) {
    cache = { ...cache, ...patch };
    save();
  },
};
