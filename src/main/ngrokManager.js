const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFile } = require('child_process');
const AdmZip = require('adm-zip');

const NGROK_ZIP = 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip';
const BIN_DIR = path.join(os.homedir(), '.minehost', 'ngrok');
const BIN_PATH = path.join(BIN_DIR, 'ngrok.exe');
const API = 'http://127.0.0.1:4040/api/tunnels';

function apiTunnels() {
  return new Promise((resolve, reject) => {
    const req = http.get(API, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('timeout')));
  });
}

class NgrokManager {
  constructor({ onLog, onState }) {
    this.onLog = onLog;
    this.onState = onState;
    this.proc = null;
    this.status = 'stopped'; // stopped | starting | running
    this.address = null;
    this.lastError = null;
  }

  static get binaryPath() {
    return BIN_PATH;
  }

  static async ensureBinary(onProgress) {
    if (fs.existsSync(BIN_PATH)) return { ok: true, path: BIN_PATH, alreadyPresent: true };

    const { download } = require('./installer');
    const zipPath = path.join(os.tmpdir(), `minehost-ngrok-${Date.now()}.zip`);

    onProgress?.({ label: 'Descargando ngrok', percent: 0 });
    await download(NGROK_ZIP, zipPath, onProgress, 'Descargando ngrok');

    fs.mkdirSync(BIN_DIR, { recursive: true });
    new AdmZip(zipPath).extractAllTo(BIN_DIR, true);
    fs.rmSync(zipPath, { force: true });

    if (!fs.existsSync(BIN_PATH)) {
      throw new Error('No se pudo extraer ngrok.exe. Puede que el antivirus lo haya bloqueado.');
    }
    onProgress?.({ label: 'ngrok listo', percent: 100 });
    return { ok: true, path: BIN_PATH, alreadyPresent: false };
  }

  getState() {
    return { status: this.status, address: this.address, error: this.lastError };
  }

  _setState(status) {
    this.status = status;
    this.onState?.(this.getState());
  }

  setAuthToken(token) {
    return new Promise((resolve) => {
      if (!fs.existsSync(BIN_PATH)) {
        return resolve({ ok: false, error: 'ngrok no está instalado todavía.' });
      }
      if (!token || !token.trim()) {
        return resolve({ ok: false, error: 'El authtoken está vacío.' });
      }
      execFile(BIN_PATH, ['config', 'add-authtoken', token.trim()], (err, stdout, stderr) => {
        if (err) return resolve({ ok: false, error: (stderr || err.message).trim() });
        resolve({ ok: true, message: (stdout || '').trim() });
      });
    });
  }

  async start(port = 25565) {
    if (this.proc) return { ok: true, address: this.address };
    if (!fs.existsSync(BIN_PATH)) {
      return { ok: false, error: 'ngrok no está instalado. Pulsa "Preparar ngrok" primero.' };
    }

    this.lastError = null;
    this.address = null;
    this._setState('starting');

    this.proc = spawn(BIN_PATH, ['tcp', String(port), '--log', 'stdout', '--log-format', 'logfmt'], {
      windowsHide: true,
    });

    let stderrBuf = '';

    this.proc.stdout.on('data', (d) => {
      const text = d.toString();
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        if (/lvl=(eror|crit)/i.test(line)) {
          const m = /err="?([^"]+)"?/.exec(line);
          this.lastError = m ? m[1] : line;
          this.onLog?.({ line, level: 'error', ts: Date.now() });
        } else {
          this.onLog?.({ line, level: 'info', ts: Date.now() });
        }
      }
    });

    this.proc.stderr.on('data', (d) => {
      stderrBuf += d.toString();
      this.onLog?.({ line: d.toString().trim(), level: 'error', ts: Date.now() });
    });

    this.proc.on('close', (code) => {
      const wasStarting = this.status === 'starting';
      this.proc = null;
      this.address = null;
      if (code !== 0 && wasStarting && !this.lastError) {
        this.lastError = stderrBuf.trim() || `ngrok terminó con código ${code}`;
      }
      this._setState('stopped');
    });

    // Poll the local API until the tunnel is published.
    for (let i = 0; i < 25; i++) {
      if (!this.proc) break;
      await new Promise((r) => setTimeout(r, 600));
      try {
        const data = await apiTunnels();
        const tunnel = (data.tunnels || []).find((t) => t.proto === 'tcp');
        if (tunnel) {
          this.address = tunnel.public_url.replace(/^tcp:\/\//, '');
          this._setState('running');
          this.onLog?.({ line: `Túnel activo en ${this.address}`, level: 'success', ts: Date.now() });
          return { ok: true, address: this.address };
        }
      } catch (_) {
        // API not up yet, keep polling.
      }
    }

    const error = this.lastError || 'No se pudo abrir el túnel. Revisa tu authtoken.';
    await this.stop();
    return { ok: false, error };
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.proc) {
        this.address = null;
        this._setState('stopped');
        return resolve({ ok: true });
      }
      const proc = this.proc;
      proc.once('close', () => resolve({ ok: true }));
      try { proc.kill(); } catch (_) {}
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch (_) {}
        resolve({ ok: true });
      }, 4000);
    });
  }
}

module.exports = NgrokManager;
