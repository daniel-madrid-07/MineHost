const os = require('os');
const https = require('https');
const net = require('net');
const { spawn } = require('child_process');

/** Private ranges, in the order a home machine is most likely to use. */
function localAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      // Skip virtual adapters; they are never the route to the router.
      if (/vEthernet|VirtualBox|VMware|Hyper-V|Loopback|Docker/i.test(name)) continue;
      out.push({ name, address: a.address });
    }
  }
  // 192.168.x.x is the usual home LAN, so rank it first.
  return out.sort((a, b) => {
    const score = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
    return score(a.address) - score(b.address);
  });
}

function publicAddress() {
  return new Promise((resolve) => {
    const req = https.get(
      'https://api.ipify.org?format=json',
      { headers: { 'User-Agent': 'MineHost' } },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); return resolve(null); }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')).ip || null); }
          catch (_) { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(6000, () => { req.destroy(); resolve(null); });
  });
}

/** Reads the default gateway, which is the router the user must configure. */
function gateway() {
  return new Promise((resolve) => {
    const proc = spawn('powershell', [
      '-NoProfile', '-Command',
      '(Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1).NextHop',
    ], { windowsHide: true });

    let out = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.on('error', () => resolve(null));
    proc.on('close', () => resolve(out.trim() || null));
    setTimeout(() => { try { proc.kill(); } catch (_) {} resolve(out.trim() || null); }, 6000);
  });
}

/** Confirms the server is actually listening locally before blaming the router. */
function isListeningLocally(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port, timeout: 2500 });
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}

/**
 * Port reachability, checked from outside via a public probe. CGNAT is inferred
 * by comparing the public address with the local one.
 */
async function testPort(port) {
  const listening = await isListeningLocally(port);
  if (!listening) return { ok: false, reason: 'not-listening' };

  const [ip, locals] = await Promise.all([publicAddress(), Promise.resolve(localAddresses())]);
  if (!ip) return { ok: false, reason: 'no-internet' };

  const reachable = await probe(ip, port);
  return {
    ok: true,
    open: reachable,
    publicIp: ip,
    localIp: locals[0]?.address || null,
  };
}

/**
 * Tries to reach the public address from this machine. Many routers hairpin, so
 * a success is conclusive; a failure is reported as "not reachable" and the UI
 * suggests checking the router rule.
 */
function probe(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 6000 });
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}

/** Adds inbound firewall rules for the port. Needs elevation, so it prompts. */
function addFirewallRule(port) {
  return new Promise((resolve) => {
    const inner = [
      `New-NetFirewallRule -DisplayName 'MineHost ${port} TCP' -Direction Inbound -Protocol TCP -LocalPort ${port} -Action Allow -Profile Any -ErrorAction Stop`,
      `New-NetFirewallRule -DisplayName 'MineHost ${port} UDP' -Direction Inbound -Protocol UDP -LocalPort ${port} -Action Allow -Profile Any -ErrorAction SilentlyContinue`,
    ].join('; ');

    const proc = spawn('powershell', [
      '-NoProfile', '-Command',
      `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-Command',"${inner}"`,
    ], { windowsHide: true });

    let err = '';
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', () => resolve({ ok: false, error: 'spawn' }));
    proc.on('close', (code) => {
      if (code === 0) return resolve({ ok: true });
      resolve({ ok: false, error: err.trim() || 'denied' });
    });
  });
}


/**
 * Installed RAM in GB. `os.totalmem()` reports what the OS can address, which
 * on a 64 GB machine is around 61.7 GB once hardware reservations are taken
 * out — showing that as "your machine has 61 GB" reads like a mistake. The
 * physical modules give the number printed on the box, so prefer it.
 */
function totalRamGb() {
  return new Promise((resolve) => {
    const fallback = Math.round(os.totalmem() / 1073741824);
    const proc = spawn('powershell', [
      '-NoProfile', '-Command',
      '(Get-CimInstance Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum).Sum',
    ], { windowsHide: true });

    let out = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.on('error', () => resolve(fallback));
    proc.on('close', () => {
      const bytes = parseInt(out.trim(), 10);
      if (!bytes || !Number.isFinite(bytes)) return resolve(fallback);
      const gb = Math.round(bytes / 1073741824);
      // Guard against a bogus reading: it can never be below what the OS sees.
      resolve(gb >= fallback ? gb : fallback);
    });
    setTimeout(() => { try { proc.kill(); } catch (_) {} resolve(fallback); }, 5000);
  });
}

async function summary(port) {
  const [ip, gw] = await Promise.all([publicAddress(), gateway()]);
  const locals = localAddresses();
  const localIp = locals[0]?.address || null;

  // A public address inside a private range means the ISP is doing CGNAT.
  const cgnat = !!ip && /^(10\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip);

  return { publicIp: ip, localIp, gateway: gw, port, cgnat, interfaces: locals };
}

module.exports = {
  localAddresses, publicAddress, gateway, summary, totalRamGb,
  testPort, addFirewallRule, isListeningLocally,
};
