const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');

const events = require('./events');
const detectRunning = require('./detectRunning');

const READY_RE   = /Done \(([\d.]+)s\)!/i;
const JOIN_RE    = /:\s*([A-Za-z0-9_]{1,16}) joined the game/i;
const LEAVE_RE   = /:\s*([A-Za-z0-9_]{1,16}) left the game/i;
const CHAT_RE    = /:\s*<([A-Za-z0-9_]{1,16})>\s*(.+)$/;
const SAVED_RE   = /Saved the game|ThreadedAnvilChunkStorage.*complete|Saving.*chunks/i;
const EULA_RE    = /You need to agree to the EULA/i;
const PORT_RE    = /Perhaps a server is already running|address already in use|FAILED TO BIND/i;
/* A missing or mismatched mod dependency never fixes itself on a retry. */
const MODS_RE    = /Missing or unsupported mandatory dependencies|requires .* or above|ModLoadingException/i;

/* Forge-likes answer /forge tps; Paper-likes answer /tps. */
const TPS_FORGE_RE = /Overall\s*:?\s*Mean tick time:\s*([\d.]+)\s*ms\.?\s*Mean TPS:\s*([\d.]+)/i;
const TPS_DIM_RE   = /Mean tick time:\s*([\d.]+)\s*ms\.?\s*Mean TPS:\s*([\d.]+)/i;
const TPS_PAPER_RE = /TPS from last 1m, 5m, 15m:\s*\*?([\d.]+)/i;

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
    this.tps = null;
    this.mspt = null;
    this.history = [];
    this.tpsTimer = null;
    this.tpsProbe = null;
    this.external = null;
    this.watchTimer = null;
  }

  getState() {
    return {
      status: this.status,
      players: [...this.players],
      startedAt: this.startedAt,
      pid: this.proc?.pid || this.external?.pid || null,
      error: this.lastError,
      // Started outside MineHost, so we can watch it but not drive it.
      external: !!this.external,
    };
  }

  /**
   * Picks up a server that is already running: launched from a script, or
   * still alive after the app was closed and reopened. We cannot read its
   * console or send it commands, but reporting it as offline would be a lie.
   */
  async adoptExisting({ serverPath, port }) {
    if (this.proc || this.external) return this.getState();

    const found = await detectRunning.detect({ serverPath, port });
    if (!found) return this.getState();

    this.external = found;
    this.startedAt = found.startedAt;
    this._setState('running');
    this._emit('Found a server already running outside MineHost.', 'system');
    this._watchExternal(port);

    return this.getState();
  }

  /** Notices when an adopted server goes away. */
  _watchExternal(port) {
    clearInterval(this.watchTimer);
    this.watchTimer = setInterval(async () => {
      if (!this.external) return clearInterval(this.watchTimer);
      if (await detectRunning.portInUse(port)) return;

      this._emit('The external server has stopped.', 'system');
      this.external = null;
      clearInterval(this.watchTimer);
      this.watchTimer = null;
      this.startedAt = null;
      this.players = [];
      this._setState('stopped');
    }, 5000);
  }

  releaseExternal() {
    clearInterval(this.watchTimer);
    this.watchTimer = null;
    this.external = null;
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

  /**
   * Finds the launcher argument file, preferring the newest version present.
   *
   * The version recorded in settings can fall behind what is actually
   * installed — after a reinstall, or when a folder was set up outside the
   * app. Launching an older build then fails on any mod that requires the
   * newer one, so the files on disk are the authority.
   */
  _findArgFile(serverPath, recorded) {
    const roots = [
      path.join(serverPath, 'libraries', 'net', 'neoforged', 'neoforge'),
      path.join(serverPath, 'libraries', 'net', 'minecraftforge', 'forge'),
    ];

    const found = [];
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      for (const dir of fs.readdirSync(root)) {
        const file = path.join(root, dir, 'win_args.txt');
        if (fs.existsSync(file)) found.push({ version: dir, file });
      }
    }
    if (!found.length) return null;

    const rank = (v) => String(v).split(/[.\-]/).map((n) => parseInt(n, 10) || 0);
    found.sort((a, b) => {
      const x = rank(a.version);
      const y = rank(b.version);
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if ((y[i] || 0) !== (x[i] || 0)) return (y[i] || 0) - (x[i] || 0);
      }
      return 0;
    });

    const newest = found[0];
    if (recorded && newest.version !== recorded) {
      this._emit(`Using NeoForge ${newest.version} (newer than the recorded ${recorded}).`, 'system');
    }
    return newest;
  }

  _launchArgs({ serverPath, platform, version, ramGb }) {
    const flags = jvmFlags(ramGb);

    if (platform === 'neoforge' || platform === 'forge') {
      const picked = this._findArgFile(serverPath, version);
      const argFile = picked?.file;
      if (argFile) {
        const jvmFile = path.join(serverPath, 'user_jvm_args.txt');
        fs.writeFileSync(jvmFile, `${flags.join('\n')}\n`, 'utf8');
        this.launchedVersion = picked.version;
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
    if (this.proc) return { ok: false, error: 'ALREADY_RUNNING' };
    if (this.external) return { ok: false, error: 'EXTERNAL_RUNNING' };

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

        this._readTps(line);

        if (EULA_RE.test(line)) this.lastError = 'eula';
        if (PORT_RE.test(line)) this.lastError = 'port';
        if (MODS_RE.test(line) && !this.lastError) this.lastError = 'mods';

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
    clearInterval(this.tpsTimer);
    clearInterval(this.watchTimer);
    this.watchTimer = null;
    this.external = null;
    this.statsTimer = null;
    this.tpsTimer = null;
    this.tps = null;
    this.mspt = null;
    this.history = [];
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
         `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($p){$i=[System.Globalization.CultureInfo]::InvariantCulture; "{0};{1}" -f $p.WorkingSet64.ToString($i),$p.TotalProcessorTime.TotalMilliseconds.ToString($i)}`],
        { windowsHide: true, timeout: 4000 },
        (err, stdout) => {
          if (err || !stdout.trim()) return;
          // Tolerate a comma decimal separator in case the invariant format
          // is ever unavailable, and refuse anything that is not a number.
          const [ws, cpuMs] = stdout.trim().split(';')
            .map((v) => Number(String(v).replace(',', '.')));
          if (!Number.isFinite(ws) || ws <= 0) return;

          const now = Date.now();
          let cpuPercent = null;
          if (lastCpu && Number.isFinite(cpuMs)) {
            const deltaCpu = cpuMs - lastCpu.cpuMs;
            const deltaWall = now - lastCpu.at;
            if (deltaWall > 0 && deltaCpu >= 0) {
              const pct = (deltaCpu / (deltaWall * os.cpus().length)) * 100;
              if (Number.isFinite(pct)) cpuPercent = Math.max(0, Math.min(100, pct));
            }
          }
          if (Number.isFinite(cpuMs)) lastCpu = { cpuMs, at: now };

          const sample = {
            ts: now,
            ramMb: Math.round(ws / 1048576),
            ramPercent: Math.round((ws / 1048576 / totalRamMb) * 100),
            cpuPercent: cpuPercent === null ? null : Math.round(cpuPercent * 10) / 10,
            players: this.players.length,
            tps: this.tps,
            mspt: this.mspt,
          };

          // Roughly an hour at one sample every three seconds.
          this.history.push(sample);
          if (this.history.length > 1200) this.history.shift();

          this.onStats?.(sample);
        }
      );
    };

    sample();
    this.statsTimer = setInterval(sample, 3000);

    // The tick-rate command is chatty, so ask far less often than we sample.
    clearInterval(this.tpsTimer);
    this.tpsTimer = setInterval(() => this._pollTps(), 15000);
    setTimeout(() => this._pollTps(), 4000);
  }

  getHistory() {
    return [...this.history];
  }

  /**
   * Picks TPS out of a console line. Values are capped at 20, the tick rate
   * Minecraft targets; servers sometimes report marginally above it.
   */
  _readTps(line) {
    const forge = TPS_FORGE_RE.exec(line) || (this.tps === null && TPS_DIM_RE.exec(line));
    if (forge) {
      this.mspt = parseFloat(forge[1]);
      this.tps = Math.min(20, parseFloat(forge[2]));
      return;
    }
    const paper = TPS_PAPER_RE.exec(line);
    if (paper) {
      this.tps = Math.min(20, parseFloat(paper[1]));
      if (this.mspt === null) this.mspt = 1000 / Math.max(1, this.tps);
    }
  }

  /**
   * Asks the server for its tick rate. The command differs by platform, and
   * silence is fine: vanilla has no such command, so TPS simply stays unknown.
   */
  _pollTps() {
    if (this.status !== 'running' || !this.proc) return;
    const platform = this.opts?.platform;
    const cmd = platform === 'paper' || platform === 'purpur' ? 'tps'
      : platform === 'neoforge' ? 'neoforge tps'
      : platform === 'forge' ? 'forge tps'
      : null;
    if (!cmd) return;

    try {
      this.proc.stdin.write(`${cmd}\n`);
    } catch (_) {}
  }

  sendCommand(cmd) {
    if (this.external) return { ok: false, error: 'EXTERNAL_NO_CONSOLE' };
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
    // An adopted server has no stdin, so it cannot be asked to save. Windows
    // offers a polite close first: Minecraft treats that as a shutdown and
    // flushes the world. Killing outright would lose the last few minutes.
    if (!this.proc && this.external) {
      const { execFile } = require('child_process');
      const pid = this.external.pid;

      const finish = (resolve) => {
        this.releaseExternal();
        this.startedAt = null;
        this.players = [];
        this._setState('stopped');
        resolve({ ok: true });
      };

      return new Promise((resolve) => {
        this._setState('stopping');
        this._emit('Asking the external server to shut down and save…', 'system');

        // /T reaches child processes; no /F, so the server can save first.
        execFile('taskkill', ['/PID', String(pid), '/T'], { windowsHide: true }, () => {});

        // Give it time to write the world out before forcing anything.
        const deadline = Date.now() + (force ? 15000 : 60000);
        const poll = setInterval(() => {
          execFile('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { windowsHide: true },
            (err, stdout) => {
              const alive = !err && stdout.includes(String(pid));
              if (!alive) {
                clearInterval(poll);
                this._emit('The external server has stopped.', 'system');
                return finish(resolve);
              }
              if (Date.now() > deadline) {
                clearInterval(poll);
                this._emit('It did not respond; closing it by force.', 'error');
                execFile('taskkill', ['/PID', String(pid), '/T', '/F'],
                  { windowsHide: true }, () => finish(resolve));
              }
            });
        }, 1500);
      });
    }

    return new Promise((resolve) => {
      if (!this.proc) return resolve({ ok: true });

      this.stopping = true;
      this._setState('stopping');
      this._emit(save ? 'Saving the world and shutting down…' : 'Shutting down…', 'system');

      const proc = this.proc;
      proc.once('close', () => resolve({ ok: true }));

      try {
        // save-all flush writes everything to disk; stop saves again on its way
        // out. Both are belt and braces, which is what you want for a world.
        if (save) proc.stdin.write('save-all flush\n');
        proc.stdin.write('stop\n');
      } catch (_) {
        try { proc.kill(); } catch (_) {}
      }

      setTimeout(() => {
        if (this.proc === proc) {
          this._emit('The server is not responding; closing it by force.', 'error');
          try { proc.kill('SIGKILL'); } catch (_) {}
          resolve({ ok: true });
        }
      }, force ? 8000 : 45000);
    });
  }
}

module.exports = ServerManager;
module.exports.jvmFlags = jvmFlags;
