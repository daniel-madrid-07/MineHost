const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const { spawn, execFile } = require('child_process');

const NEOFORGE_META = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge';
const NEOFORGE_JAR = (v) =>
  `https://maven.neoforged.net/releases/net/neoforged/neoforge/${v}/neoforge-${v}-installer.jar`;

const ADOPTIUM_API =
  'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk';

function httpsGet(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('Demasiadas redirecciones'));
    https
      .get(url, { headers: { 'User-Agent': 'MineHost' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(httpsGet(new URL(res.headers.location, url).toString(), redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} en ${url}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

function download(url, dest, onProgress, label, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('Demasiadas redirecciones'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    https
      .get(url, { headers: { 'User-Agent': 'MineHost' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          file.close();
          fs.rmSync(dest, { force: true });
          return resolve(
            download(new URL(res.headers.location, url).toString(), dest, onProgress, label, redirects + 1)
          );
        }
        if (res.statusCode !== 200) {
          res.resume();
          file.close();
          fs.rmSync(dest, { force: true });
          return reject(new Error(`HTTP ${res.statusCode} descargando ${label}`));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress && total) {
            onProgress({ label, percent: Math.round((received / total) * 100) });
          }
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(dest)));
      })
      .on('error', (err) => {
        file.close();
        fs.rmSync(dest, { force: true });
        reject(err);
      });
  });
}

function javaVersionOf(javaExe) {
  return new Promise((resolve) => {
    execFile(javaExe, ['-version'], (err, _stdout, stderr) => {
      if (err) return resolve(null);
      const m = /version "(\d+)(?:\.(\d+))?/.exec(stderr || '');
      if (!m) return resolve(null);
      let major = parseInt(m[1], 10);
      if (major === 1 && m[2]) major = parseInt(m[2], 10);
      resolve({ path: javaExe, major });
    });
  });
}

async function detectJava() {
  const candidates = [];
  const roots = [
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Microsoft\\jdk',
    'C:\\Program Files\\Amazon Corretto',
    'C:\\Program Files\\Zulu',
    path.join(os.homedir(), '.minehost', 'java'),
  ];

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
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
    if (info && info.major) checked.push(info);
  }

  const good = checked.filter((c) => c.major >= 21).sort((a, b) => b.major - a.major);
  return {
    found: good.length > 0,
    best: good[0] || null,
    all: checked,
  };
}

async function listNeoForgeVersions() {
  const raw = await httpsGet(NEOFORGE_META);
  const data = JSON.parse(raw.toString('utf8'));
  const versions = Array.isArray(data) ? data : data.versions || [];

  // NeoForge encodes MC version in its own: 21.10.x -> Minecraft 1.21.10
  const stable = versions.filter((v) => !/beta|alpha|rc/i.test(v));
  const byMinecraft = new Map();

  for (const v of stable) {
    const m = /^(\d+)\.(\d+)\./.exec(v);
    if (!m) continue;
    const mc = `1.${m[1]}.${m[2]}`;
    if (!byMinecraft.has(mc)) byMinecraft.set(mc, []);
    byMinecraft.get(mc).push(v);
  }

  const result = [];
  for (const [mc, list] of byMinecraft) {
    list.sort((a, b) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
      }
      return 0;
    });
    result.push({ minecraft: mc, latest: list[0], all: list });
  }

  result.sort((a, b) => {
    const pa = a.minecraft.split('.').map(Number);
    const pb = b.minecraft.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
    }
    return 0;
  });

  return result;
}

function inspectServer(serverPath) {
  if (!serverPath || !fs.existsSync(serverPath)) {
    return { installed: false, version: null, hasWorld: false, eula: false };
  }
  const nfDir = path.join(serverPath, 'libraries', 'net', 'neoforged', 'neoforge');
  let version = null;
  if (fs.existsSync(nfDir)) {
    const dirs = fs.readdirSync(nfDir).filter((d) =>
      fs.existsSync(path.join(nfDir, d, 'win_args.txt'))
    );
    version = dirs.sort().pop() || null;
  }
  const eulaFile = path.join(serverPath, 'eula.txt');
  return {
    installed: !!version,
    version,
    hasWorld: fs.existsSync(path.join(serverPath, 'world')),
    eula: fs.existsSync(eulaFile) && /eula\s*=\s*true/i.test(fs.readFileSync(eulaFile, 'utf8')),
  };
}

async function installJava(onProgress) {
  const targetRoot = path.join(os.homedir(), '.minehost', 'java');
  fs.mkdirSync(targetRoot, { recursive: true });

  const zipPath = path.join(os.tmpdir(), `minehost-jdk21-${Date.now()}.zip`);
  onProgress?.({ label: 'Descargando Java 21', percent: 0 });
  await download(ADOPTIUM_API, zipPath, onProgress, 'Descargando Java 21');

  onProgress?.({ label: 'Extrayendo Java 21', percent: 50 });
  const AdmZip = require('adm-zip');
  new AdmZip(zipPath).extractAllTo(targetRoot, true);
  fs.rmSync(zipPath, { force: true });

  onProgress?.({ label: 'Java 21 listo', percent: 100 });

  for (const entry of fs.readdirSync(targetRoot)) {
    const exe = path.join(targetRoot, entry, 'bin', 'java.exe');
    if (fs.existsSync(exe)) return exe;
  }
  throw new Error('No se encontró java.exe tras extraer el JDK');
}

async function installServer({ serverPath, neoforgeVersion, onProgress }) {
  fs.mkdirSync(serverPath, { recursive: true });

  let java = await detectJava();
  let javaExe = java.best?.path;
  if (!javaExe) {
    javaExe = await installJava(onProgress);
  }

  const installerJar = path.join(serverPath, `neoforge-${neoforgeVersion}-installer.jar`);
  onProgress?.({ label: `Descargando NeoForge ${neoforgeVersion}`, percent: 0 });
  await download(NEOFORGE_JAR(neoforgeVersion), installerJar, onProgress, `NeoForge ${neoforgeVersion}`);

  onProgress?.({ label: 'Instalando servidor (puede tardar un poco)', percent: 0, indeterminate: true });

  await new Promise((resolve, reject) => {
    const proc = spawn(javaExe, ['-jar', path.basename(installerJar), '--installServer'], {
      cwd: serverPath,
      windowsHide: true,
    });
    let stderr = '';
    proc.stdout.on('data', (d) => {
      const text = d.toString();
      const line = text.trim().split('\n').pop();
      if (line) onProgress?.({ label: line.slice(0, 90), percent: 0, indeterminate: true });
    });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`El instalador de NeoForge falló (código ${code}). ${stderr.slice(-400)}`));
    });
  });

  fs.rmSync(installerJar, { force: true });
  fs.rmSync(`${installerJar}.log`, { force: true });
  fs.writeFileSync(path.join(serverPath, 'eula.txt'), 'eula=true\n', 'utf8');
  fs.mkdirSync(path.join(serverPath, 'mods'), { recursive: true });

  onProgress?.({ label: 'Servidor instalado', percent: 100 });
  return { ok: true, javaPath: javaExe, version: neoforgeVersion };
}

module.exports = {
  detectJava,
  installJava,
  listNeoForgeVersions,
  installServer,
  inspectServer,
  download,
};
