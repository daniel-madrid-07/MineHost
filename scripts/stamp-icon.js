/**
 * Stamps assets/icon.ico into the built MineHost.exe.
 *
 * electron-builder can do this itself, but only with `signAndEditExecutable`
 * enabled, which drags in a code-signing toolchain whose archive contains macOS
 * symlinks. Extracting those needs either administrator rights or Windows
 * Developer Mode, so on a normal account the whole build fails before it starts.
 * Running rcedit directly sidesteps that entirely.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'assets', 'icon.ico');
const EXE = path.join(ROOT, 'release', 'win-unpacked', 'MineHost.exe');

const CACHE = path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign');

/** rcedit ships inside the winCodeSign cache; any extracted copy will do. */
function findRcedit() {
  const bundled = path.join(ROOT, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
  if (fs.existsSync(bundled)) return bundled;

  if (!fs.existsSync(CACHE)) return null;
  for (const dir of fs.readdirSync(CACHE)) {
    const candidate = path.join(CACHE, dir, 'rcedit-x64.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function main() {
  if (!fs.existsSync(EXE)) {
    console.error(`stamp-icon: ${EXE} not found; run electron-builder first.`);
    process.exit(1);
  }
  if (!fs.existsSync(ICON)) {
    console.error('stamp-icon: assets/icon.ico is missing.');
    process.exit(1);
  }

  const rcedit = findRcedit();
  if (!rcedit) {
    console.error('stamp-icon: rcedit not found; the exe keeps the default Electron icon.');
    process.exit(1);
  }

  const { version, build } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  execFileSync(rcedit, [
    EXE,
    '--set-icon', ICON,
    '--set-version-string', 'ProductName', build.productName,
    '--set-version-string', 'FileDescription', build.productName,
    '--set-version-string', 'CompanyName', build.productName,
    '--set-version-string', 'LegalCopyright', `MIT · ${new Date().getFullYear()}`,
    '--set-file-version', version,
    '--set-product-version', version,
  ], { stdio: 'inherit' });

  console.log(`stamp-icon: icon and version ${version} written into MineHost.exe`);
}

main();
