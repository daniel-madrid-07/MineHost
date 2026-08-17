const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');

const events = require('./events');

const READY_RE   = /Done \(([\d.]+)s\)!/i;
const JOIN_RE    = /:\s*([A-Za-z0-9_]{1,16}) joined the game/i;
const LEAVE_RE   = /:\s*([A-Za-z0-9_]{1,16}) left the game/i;
const CHAT_RE    = /:\s*<([A-Za-z0-9_]{1,16})>\s*(.+)$/;
const SAVED_RE   = /Saved the game|ThreadedAnvilChunkStorage.*complete|Saving.*chunks/i;
const EULA_RE    = /You need to agree to the EULA/i;
const PORT_RE    = /Perhaps a server is already running|address already in use|FAILED TO BIND/i;

/**
 * Aikar's flags: proven G1GC tuning for Minecraft servers. Applied above 4 GB,
 * where the collector actually has room to benefit.
 */
function jvmFlags(ramGb) {
  const base = [`-Xms${Math.max(1, Math.floor(ramGb / 2))}G`, `-Xmx${ramGb}G`];
  if (ramGb < 4) return base;
  return base.concat([
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=200',
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+DisableExplicitGC',
    '-XX:+AlwaysPreTouch',
    `-XX:G1NewSizePercent=${ramGb >= 12 ? 40 : 30}`,
    `-XX:G1MaxNewSizePercent=${ramGb >= 12 ? 50 : 40}`,
    `-XX:G1HeapRegionSize=${ramGb >= 12 ? 16 : 8}M`,
    '-XX:G1ReservePercent=15',
    '-XX:G1HeapWastePercent=5',
    '-XX:G1MixedGCCountTarget=4',
    '-XX:InitiatingHeapOccupancyPercent=20',
    '-XX:G1MixedGCLiveThresholdPercent=90',
    '-XX:G1RSetUpdatingPauseTimePercent=5',
    '-XX:SurvivorRatio=32',
    '-XX:+PerfDisableSharedMem',
    '-XX:MaxTenuringThreshold=1',
    '-Dusing.aikars.flags=https://mcflags.emc.gs',
    '-Daikars.new.flags=true',
  ]);
}

class ServerManager {
  constructor({ onLog, onState, onStats, onCrash, onEvent }) {
    this.onLog = onLog;
    this.onState = onState;
    this.onStats = onStats;
    this.onCrash = onCrash;
    this.onEvent = onEvent;

    this.proc = null;
    this.status = 'stopped'; // stopped | starting | running | stopping
    this.players = [];
    this.startedAt = null;
    this.opts = null;
    this.lastError = null;
    this.stopping = false;
    this.statsTimer = null;
    this.saveWaiters = [];
    this.logBuffer = [];
    this.eventBuffer = [];
  }

  getState() {
    return {
      status: this.status,
      players: [...this.players],
      startedAt: this.startedAt,
      pid: this.proc?.pid || null,
      error: this.lastError,
    };
  }

  _setState(status) {
    this.status = status;
    this.onState?.(this.getState());
  }

  _emit(line, level = 'info') {
    const entry = { line, level, ts: Date.now() };
    this.logBuffer.push(entry);
    if (this.logBuffer.length > 400) this.logBuffer.shift();
    this.onLog?.(entry);

    // Commands we sent ourselves are not "moments"; everything else may be.
    if (level === 'command') return;
    const event = events.parse(line, level);
    if (!event) return;

    const record = { ...event, ts: entry.ts };
    this.eventBuffer.push(record);
    if (this.eventBuffer.length > 300) this.eventBuffer.shift();
    this.onEvent?.(record);
  }

  getRecentLog() {
    return [...this.logBuffer];
  }

  getRecentEvents() {
    return [...this.eventBuffer];
  }

  /** Resolves once the server confirms the world has been flushed to disk. */
  waitForSave(timeoutMs = 20000) {
    return new Promise((resolve) => {
      if (this.status !== 'running') return resolve();
      const timer = setTimeout(() => {
        this.saveWaiters = this.saveWaiters.filter((w) => w !== resolve);
        resolve();
      }, timeoutMs);
      this.saveWaiters.push(() => { clearTimeout(timer); resolve(); });
    });
  }

  _launchArgs({ serverPath, platform, version, ramGb }) {
    const flags = jvmFlags(ramGb);

    if (platform === 'neoforge' || platform === 'forge') {
      const argFiles = [
        path.join(serverPath, 'libraries', 'net', 'neoforged', 'neoforge', version, 'win_args.txt'),
        path.join(serverPath, 'libraries', 'net', 'minecraftforge', 'forge', version, 'win_args.txt'),
      ];
      const argFile = argFiles.find((f) => fs.existsSync(f));
      if (argFile) {
        const jvmFile = path.join(serverPath, 'user_jvm_args.txt');
        fs.writeFileSync(jvmFile, `${flags.join('\n')}\n`, 'utf8');
        return [
          `@${path.basename(jvmFile)}`,
          `@${path.relative(serverPath, argFile).replace(/\\/g, '/')}`,
          'nogui',
        ];
      }
      // Older Forge ships a plain runnable jar instead of an args file.
    }

    const jar = ['server.jar', 'minecraft_server.jar'].find((f) =>
      fs.existsSync(path.join(serverPath, f))
    );
    if (!jar) return null;
    return [...flags, '-jar', jar, 'nogui'];
  }

  start(opts) {
    if (this.proc) return { ok: false, error: 'El servidor ya está en marcha.' };

    const { serverPath, javaPath, ramGb } = opts;

    if (!fs.existsSync(serverPath)) {
      return { ok: false, error: 'La carpeta del servidor ya no existe.' };
    }

    const eula = path.join(serverPath, 'eula.txt');
    if (!fs.existsSync(eula) || !/eula\s*=\s*true/i.test(fs.readFileSync(eula, 'utf8'))) {
      return { ok: false, error: 'Falta aceptar el EULA de Minecraft.' };
    }

    const args = this._launchArgs(opts);
    if (!args) {
      return { ok: false, error: 'No se encuentra el servidor instalado en esa carpeta. Instálalo de nuevo.' };
    }

    this.opts = opts;
    this.players = [];
    this.lastError = null;
    this.stopping = false;
    this._setState('starting');
    this._emit(`Arrancando ${opts.platformName || opts.platform} con ${ramGb} GB de RAM.`, 'system');

    try {
      this.proc = spawn(javaPath, args, { cwd: serverPath, windowsHide: true });
    } catch (err) {
      this.proc = null;
      this._setState('stopped');
      return { ok: false, error: `No se pudo lanzar Java: ${err.message}` };
    }

    const handle = (buf, level) => {
      for (const raw of buf.toString().split(/\r?\n/)) {
        const line = raw.trimEnd();
        if (!line) continue;
        this._emit(line, level);

        if (this.status === 'starting' && READY_RE.test(line)) {
          this.startedAt = Date.now();
          this._setState('running');
          this._emit('Listo. Ya se puede entrar al servidor.', 'success');
          this._startStats();
        }

        if (SAVED_RE.test(line) && this.saveWaiters.length) {
          const waiters = this.saveWaiters;
          this.saveWaiters = [];
          waiters.forEach((w) => w());
        }

        if (EULA_RE.test(line)) this.lastError = 'eula';
        if (PORT_RE.test(line)) this.lastError = 'port';

        const j = JOIN_RE.exec(line);
        if (j && !this.players.includes(j[1])) {
          this.players.push(j[1]);
          this.onState?.(this.getState());
        }
        const l = LEAVE_RE.exec(line);
        if (l) {
          this.players = this.players.filter((p) => p !== l[1]);
          this.onState?.(this.getState());
        }
      }
    };

    this.proc.stdout.on('data', (d) => handle(d, 'info'));
    this.proc.stderr.on('data', (d) => handle(d, 'error'));

    this.proc.on('error', (err) => {
      this._emit(`Error al ejecutar Java: ${err.message}`, 'error');
      this._cleanup();
    });

    this.proc.on('close', (code) => {
      const wasRunning = this.status === 'running' || this.status === 'starting';
      const clean = this.stopping || code === 0;

      this._emit(
        clean ? 'Servidor detenido.' : `El servidor se cerró de forma inesperada (código ${code}).`,
        clean ? 'system' : 'error'
      );

      const reason = this.lastError;
      this._cleanup();

      if (!clean && wasRunning) {
        this.onCrash?.({ code, reason });
      }
    });

    return { ok: true };
  }

  _cleanup() {
    clearInterval(this.statsTimer);
    this.statsTimer = null;
    this.proc = null;
    this.players = [];
    this.startedAt = null;
    this.stopping = false;
    this.saveWaiters.forEach((w) => w());
    this.saveWaiters = [];
    this._setState('stopped');
  }

  /** Samples the Java process for CPU and memory using Windows tooling. */
  _startStats() {
    clearInterval(this.statsTimer);
    const pid = this.proc?.pid;
    if (!pid) return;

    const totalRamMb = os.totalmem() / 1048576;
    let lastCpu = null;

    const sample = () => {
      if (!this.proc) return;
      execFile(
        'powershell',
        ['-NoProfile', '-Command',
         `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($p){"{0};{1}" -f $p.WorkingSet64,$p.TotalProcessorTime.TotalMilliseconds}`],
        { windowsHide: true, timeout: 4000 },
        (err, stdout) => {
          if (err || !stdout.trim()) return;
          const [ws, cpuMs] = stdout.trim().split(';').map(Number);
          if (!ws) return;

          const now = Date.now();
          let cpuPercent = null;
          if (lastCpu) {
            const deltaCpu = cpuMs - lastCpu.cpuMs;
            const deltaWall = now - lastCpu.at;
            if (deltaWall > 0) {
              cpuPercent = Math.max(0, Math.min(100,
                (deltaCpu / (deltaWall * os.cpus().length)) * 100));
            }
          }
          lastCpu = { cpuMs, at: now };

          this.onStats?.({
            ramMb: Math.round(ws / 1048576),
            ramPercent: Math.round((ws / 1048576 / totalRamMb) * 100),
            cpuPercent: cpuPercent === null ? null : Math.round(cpuPercent * 10) / 10,
            players: this.players.length,
          });
        }
      );
    };

    sample();
    this.statsTimer = setInterval(sample, 3000);
  }

  sendCommand(cmd) {
    if (!this.proc || this.status === 'stopped') {
      return { ok: false, error: 'El servidor no está en marcha.' };
    }
    try {
      this.proc.stdin.write(`${cmd}\n`);
    } catch (err) {
      return { ok: false, error: `No se pudo enviar el comando: ${err.message}` };
    }
    this._emit(`> ${cmd}`, 'command');
    return { ok: true };
  }

  stop({ force = false, save = true } = {}) {
    return new Promise((resolve) => {
      if (!this.proc) return resolve({ ok: true });

      this.stopping = true;
      this._setState('stopping');
      this._emit(save ? 'Guardando el mundo y cerrando…' : 'Cerrando…', 'system');

      const proc = this.proc;
      proc.once('close', () => resolve({ ok: true }));

      try {
        if (save) proc.stdin.write('save-all flush\n');
        proc.stdin.write('stop\n');
      } catch (_) {
        try { proc.kill(); } catch (_) {}
      }

      setTimeout(() => {
        if (this.proc === proc) {
          this._emit('El servidor no responde; forzando el cierre.', 'error');
          try { proc.kill('SIGKILL'); } catch (_) {}
          resolve({ ok: true });
        }
      }, force ? 8000 : 45000);
    });
  }
}

module.exports = ServerManager;
module.exports.jvmFlags = jvmFlags;
