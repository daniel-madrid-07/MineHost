/**
 * Lightweight scheduler for restarts and automatic backups. Checks once a
 * minute rather than holding long timers, so it survives sleep and clock drift.
 */

const WARNINGS = [
  { at: 300, key: 'restart.in5min' },
  { at: 60,  key: 'restart.in1min' },
  { at: 10,  key: 'restart.in10sec' },
];

class Scheduler {
  constructor({ onLog, runRestart, runBackup, isRunning, t }) {
    this.onLog = onLog;
    this.runRestart = runRestart;
    this.runBackup = runBackup;
    this.isRunning = isRunning;
    // Announcements go to players in chat, so they follow the app's language.
    this.t = t || ((k) => k);

    this.config = { restart: { enabled: false, time: '05:00' }, backup: { enabled: false, everyHours: 6 } };
    this.timer = null;
    this.pendingRestart = null;
    this.lastBackupAt = 0;
    this.lastTickKey = null;
  }

  configure(config) {
    this.config = { ...this.config, ...config };
    this.stop();
    if (this.config.restart?.enabled || this.config.backup?.enabled) this.start();
    return this.config;
  }

  getConfig() {
    return { ...this.config, nextRestart: this._nextRestartAt(), lastBackupAt: this.lastBackupAt };
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this._tick(), 15000);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.pendingRestart) {
      clearTimeout(this.pendingRestart.timer);
      this.pendingRestart = null;
    }
  }

  _nextRestartAt() {
    if (!this.config.restart?.enabled) return null;
    const [h, m] = String(this.config.restart.time || '05:00').split(':').map(Number);
    const next = new Date();
    next.setSeconds(0, 0);
    next.setHours(h || 0, m || 0);
    if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
    return next.getTime();
  }

  async _tick() {
    const now = Date.now();

    if (this.config.backup?.enabled) {
      const everyMs = Math.max(1, this.config.backup.everyHours || 6) * 3600000;
      if (this.lastBackupAt && now - this.lastBackupAt >= everyMs) {
        this.lastBackupAt = now;
        this.onLog?.({ line: 'Copia de seguridad programada en curso…', level: 'system', ts: now });
        try { await this.runBackup('programada'); } catch (_) {}
      } else if (!this.lastBackupAt) {
        this.lastBackupAt = now;
      }
    }

    if (!this.config.restart?.enabled || !this.isRunning()) return;

    const target = this._nextRestartAt();
    if (!target) return;
    const secondsLeft = Math.round((target - now) / 1000);

    for (const w of WARNINGS) {
      const key = `${target}-${w.at}`;
      if (secondsLeft <= w.at && secondsLeft > w.at - 20 && this.lastTickKey !== key) {
        this.lastTickKey = key;
        this.runRestart({ announceOnly: true, message: this.t(w.key) });
      }
    }

    if (secondsLeft <= 0 && secondsLeft > -30) {
      const key = `${target}-go`;
      if (this.lastTickKey !== key) {
        this.lastTickKey = key;
        this.onLog?.({ line: 'Reinicio programado.', level: 'system', ts: now });
        this.runRestart({ announceOnly: false });
      }
    }
  }
}

module.exports = Scheduler;
