const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const READY_RE = /Done \(([\d.]+)s\)!/i;
const JOIN_RE = /:\s*(\w{3,16}) joined the game/i;
const LEAVE_RE = /:\s*(\w{3,16}) left the game/i;

class ServerManager {
  constructor({ onLog, onState }) {
    this.onLog = onLog;
    this.onState = onState;
    this.proc = null;
    this.status = 'stopped'; // stopped | starting | running | stopping
    this.players = [];
    this.startedAt = null;
  }

  getState() {
    return {
      status: this.status,
      players: [...this.players],
      startedAt: this.startedAt,
      pid: this.proc?.pid || null,
    };
  }

  _setState(status) {
    this.status = status;
    this.onState?.(this.getState());
  }

  _emit(line, level = 'info') {
    this.onLog?.({ line, level, ts: Date.now() });
  }

  start({ serverPath, javaPath, ramGb, neoforgeVersion }) {
    if (this.proc) return { ok: false, error: 'El servidor ya está en marcha.' };

    const argsFile = path.join(
      serverPath, 'libraries', 'net', 'neoforged', 'neoforge', neoforgeVersion, 'win_args.txt'
    );
    if (!fs.existsSync(argsFile)) {
      return { ok: false, error: `No se encuentra la instalación de NeoForge ${neoforgeVersion}. Reinstala el servidor.` };
    }

    const eula = path.join(serverPath, 'eula.txt');
    if (!fs.existsSync(eula) || !/eula\s*=\s*true/i.test(fs.readFileSync(eula, 'utf8'))) {
      return { ok: false, error: 'Debes aceptar el EULA de Minecraft antes de arrancar.' };
    }

    const ram = Math.max(1, parseInt(ramGb, 10) || 4);
    const jvmArgsPath = path.join(serverPath, 'user_jvm_args.txt');
    fs.writeFileSync(jvmArgsPath, `-Xmx${ram}G\n-Xms${Math.max(1, Math.floor(ram / 2))}G\n`, 'utf8');

    this.players = [];
    this._setState('starting');
    this._emit(`Arrancando servidor con ${ram} GB de RAM...`, 'system');

    this.proc = spawn(
      javaPath,
      [`@${path.basename(jvmArgsPath)}`, `@${path.relative(serverPath, argsFile).replace(/\\/g, '/')}`, 'nogui'],
      { cwd: serverPath, windowsHide: true }
    );

    const handle = (buf, level) => {
      for (const raw of buf.toString().split(/\r?\n/)) {
        const line = raw.trimEnd();
        if (!line) continue;
        this._emit(line, level);

        if (this.status === 'starting' && READY_RE.test(line)) {
          this.startedAt = Date.now();
          this._setState('running');
          this._emit('El servidor está listo para recibir jugadores.', 'success');
        }
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
      this._emit(`Error al lanzar Java: ${err.message}`, 'error');
      this.proc = null;
      this.startedAt = null;
      this._setState('stopped');
    });

    this.proc.on('close', (code) => {
      this._emit(`El servidor se ha detenido (código ${code}).`, code === 0 ? 'system' : 'error');
      this.proc = null;
      this.players = [];
      this.startedAt = null;
      this._setState('stopped');
    });

    return { ok: true };
  }

  sendCommand(cmd) {
    if (!this.proc || this.status === 'stopped') {
      return { ok: false, error: 'El servidor no está en marcha.' };
    }
    this.proc.stdin.write(`${cmd}\n`);
    this._emit(`> ${cmd}`, 'command');
    return { ok: true };
  }

  stop(force = false) {
    return new Promise((resolve) => {
      if (!this.proc) return resolve({ ok: true });

      this._setState('stopping');
      this._emit('Guardando y deteniendo el servidor...', 'system');

      const proc = this.proc;
      const done = () => resolve({ ok: true });
      proc.once('close', done);

      try {
        proc.stdin.write('stop\n');
      } catch (_) {
        try { proc.kill(); } catch (_) {}
      }

      const timeout = force ? 8000 : 30000;
      setTimeout(() => {
        if (this.proc === proc) {
          this._emit('El servidor no respondió, forzando cierre.', 'error');
          try { proc.kill('SIGKILL'); } catch (_) {}
          resolve({ ok: true });
        }
      }, timeout);
    });
  }
}

module.exports = ServerManager;
