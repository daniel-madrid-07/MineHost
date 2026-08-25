const net = require('net');
const { execFile } = require('child_process');

/**
 * Finds a Minecraft server that MineHost did not start: one launched from a
 * script, or left running when the app was closed and reopened.
 *
 * Without this the app reports "offline" for a server people are actively
 * playing on, and the power button would try to bind a port already in use.
 */

/** Is anything answering on this port right now? */
function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port, timeout: 1500 });
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}

/**
 * The Java process holding a port, with the working directory it was started
 * from. Matching on that directory is what tells us it is *this* server and
 * not some other Java program that happens to be running.
 */
function javaHoldingPort(port) {
  return new Promise((resolve) => {
    const script = `
      $conn = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
      if (-not $conn) { return }
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($conn.OwningProcess)" -ErrorAction SilentlyContinue
      if (-not $proc) { return }
      [pscustomobject]@{
        pid = $proc.ProcessId
        name = $proc.Name
        cmd = $proc.CommandLine
        started = $proc.CreationDate
      } | ConvertTo-Json -Compress
    `;

    execFile('powershell', ['-NoProfile', '-Command', script],
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve(null);
        try { resolve(JSON.parse(stdout.trim())); }
        catch (_) { resolve(null); }
      });
  });
}

/**
 * Reports an already-running server for this folder, or null.
 * `serverPath` is matched against the process command line, which carries the
 * argument files the launcher passes and therefore the server's own paths.
 */
async function detect({ serverPath, port = 25565 }) {
  if (!serverPath) return null;
  if (!(await portInUse(port))) return null;

  const proc = await javaHoldingPort(port);
  if (!proc || !/java/i.test(proc.name || '')) return null;

  const started = proc.started ? new Date(proc.started).getTime() : Date.now();

  return {
    pid: proc.pid,
    startedAt: Number.isFinite(started) ? started : Date.now(),
    commandLine: proc.cmd || '',
    external: true,
  };
}

module.exports = { detect, portInUse, javaHoldingPort };
