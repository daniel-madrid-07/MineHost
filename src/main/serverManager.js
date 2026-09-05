const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');

const events = require('./events');
const detectRunning = require('./detectRunning');
const patterns = require('./server/logPatterns');
const { jvmFlags } = require('./server/jvmFlags');
const { StatsMonitor } = require('./server/statsMonitor');

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
    this.stats = new StatsMonitor({
      onSample: (sample) => this.onStats?.(sample),
      getContext: () => ({
        players: this.players.length,
        tps: this.tps,
        mspt: this.mspt,
      }),
    });
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
      return { ok: false, error: 'SERVER_FOLDER_GONE' };
    }

    const eula = path.join(serverPath, 'eula.txt');
    if (!fs.existsSync(eula) || !/eula\s*=\s*true/i.test(fs.readFileSync(eula, 'utf8'))) {
      return { ok: false, error: 'EULA_NOT_ACCEPTED' };
    }

    const args = this._launchArgs(opts);
    if (!args) {
      return { ok: false, error: 'SERVER_NOT_INSTALLED' };
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

        if (this.status === 'starting' && patterns.READY.test(line)) {
          this.startedAt = Date.now();
          this._setState('running');
          this._emit('Listo. Ya se puede entrar al servidor.', 'success');
          this._startStats();
        }

        if (patterns.SAVED.test(line) && this.saveWaiters.length) {
          const waiters = this.saveWaiters;
          this.saveWaiters = [];
          waiters.forEach((w) => w());
        }

        this._readTps(line);

        if (patterns.EULA.test(line)) this.lastError = 'eula';
        if (patterns.PORT.test(line)) this.lastError = 'port';
        if (patterns.MODS.test(line) && !this.lastError) this.lastError = 'mods';

        const j = patterns.JOIN.exec(line);
        if (j && !this.players.includes(j[1])) {
          this.players.push(j[1]);
          this.onState?.(this.getState());
        }
        const l = patterns.LEAVE.exec(line);
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
    this._stopStats();
    clearInterval(this.watchTimer);
    this.watchTimer = null;
    this.external = null;
    this.statsTimer = null;
    this.tpsTimer = null;
    this.tps = null;
    this.mspt = null;
    this.proc = null;
    this.players = [];
    this.startedAt = null;
    this.stopping = false;
    this.saveWaiters.forEach((w) => w());
    this.saveWaiters = [];
    this._setState('stopped');
  }

  /**
   * Samples the Java process for CPU and memory.
   *
   * The naive approach — one `powershell` call per sample — cost about 107 ms
   * of process start-up every three seconds, roughly two minutes of CPU per
   * hour spent purely on measuring. Node cannot read another process's counters
   * itself, so instead a single PowerShell stays open and prints a reading on
   * its own schedule. One process for the whole session rather than 1200/hour.
   */
  _startStats() {
    this._stopStats();
    const pid = this.proc?.pid;
    if (!pid) return;

    this.stats.start(pid);

    // The tick-rate command is chatty, so ask far less often than we sample.
    this.tpsTimer = setInterval(() => this._pollTps(), 15000);
    setTimeout(() => this._pollTps(), 4000);
  }

  _stopStats() {
    clearInterval(this.tpsTimer);
    this.tpsTimer = null;
    this.stats.stop();
  }

  getHistory() {
    return this.stats.getHistory();
  }

  /** Records a tick rate if this line carries one. */
  _readTps(line) {
    const reading = patterns.readTps(line);
    if (!reading) return;
    // Servers sometimes report a hair above 20, the rate Minecraft targets.
    this.tps = Math.min(20, reading.tps);
    if (reading.mspt !== null) this.mspt = reading.mspt;
  }

  /** Asks the server for its tick rate, in whichever dialect it speaks. */
  _pollTps() {
    if (this.status !== 'running' || !this.proc) return;
    const cmd = patterns.tpsCommand(this.platform);
    if (!cmd) return;
    try { this.proc.stdin.write(cmd + '\n'); } catch (_) {}
  }

  sendCommand(cmd) {
    if (this.external) return { ok: false, error: 'EXTERNAL_NO_CONSOLE' };
    if (!this.proc || this.status === 'stopped') {
      return { ok: false, error: 'SERVER_NOT_RUNNING' };
    }
    try {
      this.proc.stdin.write(`${cmd}\n`);
    } catch (err) {
      return { ok: false, error: 'COMMAND_FAILED', detail: err.message };
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
