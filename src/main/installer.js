const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const { spawn, execFile } = require('child_process');

const { PLATFORMS } = require('./platforms');

const ADOPTIUM = (major) =>
  `https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk`;

const UA = 'MineHost/1.0';

function download(url, dest, onProgress, label, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('Demasiadas redirecciones'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        file.close();
        fs.rmSync(dest, { force: true });
        return resolve(download(new URL(res.headers.location, url).toString(), dest, onProgress, label, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        file.close();
        fs.rmSync(dest, { force: true });
        return reject(new Error(`HTTP ${res.statusCode} al descargar ${label}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let done = 0;
      res.on('data', (c) => {
        done += c.length;
        if (onProgress && total) onProgress({ label, percent: Math.round((done / total) * 100) });
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
    }).on('error', (err) => {
      file.close();
      fs.rmSync(dest, { force: true });
      reject(err);
    });
  });
}

function javaVersionOf(exe) {
  return new Promise((resolve) => {
    execFile(exe, ['-version'], { timeout: 8000, windowsHide: true }, (err, _out, stderr) => {
      if (err) return resolve(null);
      const m = /version "(\d+)(?:\.(\d+))?/.exec(stderr || '');
      if (!m) return resolve(null);
      let major = parseInt(m[1], 10);
      if (major === 1 && m[2]) major = parseInt(m[2], 10);
      resolve({ path: exe, major });
    });
  });
}

/** Minecraft's own Java requirement by version. */
function requiredJava(mcVersion) {
  const parts = String(mcVersion).split('.').map(Number);
  const major = parts[0] || 1;
  const minor = parts[1] || 0;
  if (major >= 26) return 21;
  if (major === 1 && minor >= 20) return 21;
  if (major === 1 && minor >= 18) return 17;
  if (major === 1 && minor >= 17) return 16;
  return 8;
}

async function detectJava(minMajor = 21) {
  const roots = [
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Microsoft\\jdk',
    'C:\\Program Files\\Amazon Corretto',
    'C:\\Program Files\\Zulu',
    'C:\\Program Files\\BellSoft',
    path.join(os.homedir(), '.minehost', 'java'),
  ];

  const candidates = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let entries = [];
    try { entries = fs.readdirSync(root); } catch (_) { continue; }
    for (const entry of entries) {
      const exe = path.join(root, entry, 'bin', 'java.exe');
      if (fs.existsSync(exe)) candidates.push(exe);
    }
  }
  if (process.env.JAVA_HOME) {
    const exe = path.join(process.env.JAVA_HOME, 'bin', 'java.exe');
    if (fs.existsSync(exe)) candidates.push(exe);
  }
  candidates.push('java');

  const checked = [];
  for (const c of candidates) {
    const info = await javaVersionOf(c);
    if (info?.major) checked.push(info);
  }

  const usable = checked.filter((c) => c.major >= minMajor).sort((a, b) => a.major - b.major);
  return { found: usable.length > 0, best: usable[0] || null, all: checked, required: minMajor };
}

async function installJava(major, onProgress) {
  const root = path.join(os.homedir(), '.minehost', 'java');
  fs.mkdirSync(root, { recursive: true });

  const zipPath = path.join(os.tmpdir(), `minehost-jdk${major}-${Date.now()}.zip`);
  await download(ADOPTIUM(major), zipPath, onProgress, `Java ${major}`);

  onProgress?.({ label: `Instalando Java ${major}…`, indeterminate: true });
  const AdmZip = require('adm-zip');
  new AdmZip(zipPath).extractAllTo(root, true);
  fs.rmSync(zipPath, { force: true });

  for (const entry of fs.readdirSync(root)) {
    const exe = path.join(root, entry, 'bin', 'java.exe');
    if (fs.existsSync(exe)) {
      const info = await javaVersionOf(exe);
      if (info?.major >= major) return exe;
    }
  }
  throw new Error('JAVA_NOT_FOUND_AFTER_INSTALL');
}

/** Reports what is already installed in a folder, if anything. */
function inspectServer(serverPath) {
  const empty = { installed: false, platform: null, version: null, build: null, hasWorld: false, eula: false };
  if (!serverPath || !fs.existsSync(serverPath)) return empty;

  const metaFile = path.join(serverPath, '.minehost.json');
  let meta = null;
  if (fs.existsSync(metaFile)) {
    try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (_) {}
  }

  const hasArgs = ['neoforged/neoforge', 'minecraftforge/forge'].some((rel) => {
    const dir = path.join(serverPath, 'libraries', 'net', ...rel.split('/'));
    return fs.existsSync(dir)
      && fs.readdirSync(dir).some((d) => fs.existsSync(path.join(dir, d, 'win_args.txt')));
  });
  const hasJar = ['server.jar', 'minecraft_server.jar'].some((f) =>
    fs.existsSync(path.join(serverPath, f))
  );

  const eulaFile = path.join(serverPath, 'eula.txt');
  const levelName = meta?.levelName || 'world';

  return {
    installed: !!(meta?.platform && (hasArgs || hasJar)) || hasArgs || hasJar,
    platform: meta?.platform || (hasArgs ? 'neoforge' : hasJar ? 'vanilla' : null),
    version: meta?.version || null,
    build: meta?.build || null,
    minecraft: meta?.minecraft || meta?.version || null,
    hasWorld: fs.existsSync(path.join(serverPath, levelName)),
    eula: fs.existsSync(eulaFile) && /eula\s*=\s*true/i.test(fs.readFileSync(eulaFile, 'utf8')),
  };
}

function writeMeta(serverPath, meta) {
  fs.writeFileSync(
    path.join(serverPath, '.minehost.json'),
    JSON.stringify({ ...meta, updatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
}

async function installServer({ serverPath, platformId, minecraft, build, onProgress }) {
  const platform = PLATFORMS[platformId];
  if (!platform) throw new Error(`Plataforma desconocida: ${platformId}`);

  fs.mkdirSync(serverPath, { recursive: true });

  const javaMajor = requiredJava(minecraft);
  onProgress?.({ label: 'Buscando Java…', indeterminate: true });
  let java = await detectJava(javaMajor);
  let javaPath = java.best?.path;
  if (!javaPath) {
    onProgress?.({ label: `Descargando Java ${javaMajor}…`, percent: 0 });
    javaPath = await installJava(javaMajor, onProgress);
  }

  let resolvedBuild = build;

  if (platform.install === 'installer') {
    const url = platform.installerUrl(minecraft, build);
    const jar = path.join(serverPath, `installer-${build}.jar`);
    await download(url, jar, onProgress, `${platform.name} ${build}`);

    onProgress?.({ label: 'Instalando el servidor (esto tarda un poco)…', indeterminate: true });
    await new Promise((resolve, reject) => {
      const proc = spawn(javaPath, ['-jar', path.basename(jar), '--installServer'], {
        cwd: serverPath, windowsHide: true,
      });
      let tail = '';
      proc.stdout.on('data', (d) => {
        const line = d.toString().trim().split('\n').pop();
        if (line) onProgress?.({ label: line.slice(0, 88), indeterminate: true });
      });
      proc.stderr.on('data', (d) => { tail += d.toString(); });
      proc.on('error', reject);
      proc.on('close', (code) => code === 0
        ? resolve()
        : reject(new Error(`El instalador falló (código ${code}). ${tail.slice(-300)}`)));
    });

    fs.rmSync(jar, { force: true });
    fs.rmSync(`${jar}.log`, { force: true });
  } else {
    const resolved = await platform.jarUrl(minecraft);
    const url = typeof resolved === 'string' ? resolved : resolved.url;
    if (typeof resolved === 'object' && resolved.build) resolvedBuild = resolved.build;
    await download(url, path.join(serverPath, 'server.jar'), onProgress, `${platform.name} ${minecraft}`);
  }

  fs.writeFileSync(path.join(serverPath, 'eula.txt'), 'eula=true\n', 'utf8');
  if (platform.modsDir) fs.mkdirSync(path.join(serverPath, platform.modsDir), { recursive: true });

  writeMeta(serverPath, {
    platform: platformId,
    platformName: platform.name,
    minecraft,
    version: platform.install === 'installer' ? build : minecraft,
    build: resolvedBuild,
    javaPath,
    javaMajor,
    levelName: 'world',
  });

  onProgress?.({ label: 'Servidor listo', percent: 100 });
  return { ok: true, javaPath, platform: platformId, minecraft, build: resolvedBuild };
}

module.exports = {
  detectJava, installJava, requiredJava,
  installServer, inspectServer, writeMeta, download,
};
