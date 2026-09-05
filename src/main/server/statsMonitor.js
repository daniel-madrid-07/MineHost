/**
 * Samples a running server's memory and CPU.
 *
 * Node cannot read a child process's CPU time — `cpuUsage` only reports the
 * current process — so this asks Windows instead. One long-lived PowerShell
 * loop does the polling and prints a line per reading, which costs far less
 * than spawning a shell for every sample.
 */
const os = require('os');
const { spawn } = require('child_process');

/* One reading every three seconds; 1200 of them is roughly an hour of history. */
const SAMPLE_MS = 3000;
const HISTORY_LIMIT = 1200;

class StatsMonitor {
  /**
   * @param {object}   opts
   * @param {Function} opts.onSample   Receives each completed sample.
   * @param {Function} opts.getContext Supplies the values this module cannot
   *   observe itself: who is online and the current tick rate.
   */
  constructor({ onSample, getContext }) {
    this.onSample = onSample;
    this.getContext = getContext;
    this.proc = null;
    this.history = [];
  }

  start(pid) {
    this.stop();
    if (!pid) return;

    const totalRamMb = os.totalmem() / 1048576;
    const cores = os.cpus().length;
    let last = null;

    // Invariant formatting keeps the decimal separator predictable: a Spanish
    // or French Windows would otherwise print "5259546,875" and break Number().
    const script = `
      $i = [System.Globalization.CultureInfo]::InvariantCulture
      while ($true) {
        $p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
        if (-not $p) { break }
        "{0};{1}" -f $p.WorkingSet64.ToString($i), $p.TotalProcessorTime.TotalMilliseconds.ToString($i)
        Start-Sleep -Milliseconds $env:MH_SAMPLE_MS
      }
    `;

    try {
      this.proc = spawn('powershell', ['-NoProfile', '-Command', script], {
        windowsHide: true,
        env: { ...process.env, MH_SAMPLE_MS: String(SAMPLE_MS) },
      });
    } catch (_) {
      return;   // Without samples the app still runs; it just shows no graph.
    }

    let buffer = '';
    this.proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        const [ws, cpuMs] = line.trim().split(';')
          .map((v) => Number(String(v).replace(',', '.')));
        if (!Number.isFinite(ws) || ws <= 0) continue;

        const now = Date.now();

        // CPU is a rate, so it needs two readings to mean anything.
        let cpuPercent = null;
        if (last && Number.isFinite(cpuMs)) {
          const deltaCpu = cpuMs - last.cpuMs;
          const deltaWall = now - last.at;
          if (deltaWall > 0 && deltaCpu >= 0) {
            const pct = (deltaCpu / (deltaWall * cores)) * 100;
            if (Number.isFinite(pct)) cpuPercent = Math.max(0, Math.min(100, pct));
          }
        }
        if (Number.isFinite(cpuMs)) last = { cpuMs, at: now };

        const { players, tps, mspt } = this.getContext();
        const sample = {
          ts: now,
          ramMb: Math.round(ws / 1048576),
          ramPercent: Math.round((ws / 1048576 / totalRamMb) * 100),
          cpuPercent: cpuPercent === null ? null : Math.round(cpuPercent * 10) / 10,
          players,
          tps,
          mspt,
        };

        this.history.push(sample);
        if (this.history.length > HISTORY_LIMIT) this.history.shift();
        this.onSample?.(sample);
      }
    });

    this.proc.on('error', () => { this.proc = null; });
    this.proc.on('close', () => { this.proc = null; });
  }

  stop() {
    if (this.proc) {
      try { this.proc.kill(); } catch (_) {}
      this.proc = null;
    }
  }

  getHistory() {
    return [...this.history];
  }
}

module.exports = { StatsMonitor, SAMPLE_MS };
