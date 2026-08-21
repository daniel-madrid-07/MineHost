const net = require('net');

/**
 * Starts the server when somebody tries to join, and stops it once everyone
 * has left. While the server is off, this listener holds the port and answers
 * Minecraft's status ping itself, so the entry in the players' server list
 * shows a message instead of looking dead.
 *
 * The port is handed over before starting the real server, and taken back once
 * it stops; only one of the two ever listens at a time.
 */

/* Minecraft's protocol writes lengths and IDs as VarInts. */
function writeVarInt(value) {
  const bytes = [];
  let v = value;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return Buffer.from(bytes);
}

function readVarInt(buf, offset = 0) {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buf.length) {
    const byte = buf[pos++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: result, size: pos - offset };
    shift += 7;
    if (shift > 35) break;
  }
  return null;
}

function packet(id, payload) {
  const body = Buffer.concat([writeVarInt(id), payload]);
  return Buffer.concat([writeVarInt(body.length), body]);
}

function stringField(text) {
  const raw = Buffer.from(text, 'utf8');
  return Buffer.concat([writeVarInt(raw.length), raw]);
}

class WakeOnDemand {
  constructor({ onWake, onLog, getStatus }) {
    this.onWake = onWake;
    this.onLog = onLog;
    this.getStatus = getStatus;

    this.server = null;
    this.port = 25565;
    this.motd = '';
    this.version = '';
    this.waking = false;
    this.idleTimer = null;
    this.idleMinutes = 10;
  }

  get listening() {
    return !!this.server;
  }

  /** Occupies the port while the real server is off. */
  listen({ port, motd, version }) {
    return new Promise((resolve) => {
      if (this.server) return resolve({ ok: true });

      this.port = port || 25565;
      this.motd = motd || 'MineHost';
      this.version = version || '';
      this.waking = false;

      const server = net.createServer((socket) => this._handle(socket));

      server.on('error', (err) => {
        this.server = null;
        // A busy port usually means the real server is already up.
        resolve({ ok: false, error: err.code === 'EADDRINUSE' ? 'PORT_BUSY' : err.message });
      });

      server.listen(this.port, () => {
        this.server = server;
        this.onLog?.({
          line: `Wake-on-demand listening on port ${this.port}`,
          level: 'system', ts: Date.now(),
        });
        resolve({ ok: true });
      });
    });
  }

  /** Frees the port so the real server can bind it. */
  stop() {
    return new Promise((resolve) => {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
      if (!this.server) return resolve();
      const server = this.server;
      this.server = null;
      server.close(() => resolve());
      // Existing sockets would keep the port busy.
      server.getConnections((_e, count) => { if (count) server.unref(); });
    });
  }

  _handle(socket) {
    socket.setTimeout(8000);
    socket.on('timeout', () => socket.destroy());
    socket.on('error', () => {});

    socket.once('data', (chunk) => {
      const parsed = this._parseHandshake(chunk);

      // next state 1 is the server list ping, 2 is an actual join attempt.
      if (parsed?.nextState === 2) {
        this._reject(socket, parsed.protocol);
        this._wake();
        return;
      }

      this._respondToPing(socket);
    });
  }

  _parseHandshake(chunk) {
    try {
      const length = readVarInt(chunk, 0);
      if (!length) return null;
      let pos = length.size;

      const id = readVarInt(chunk, pos);
      if (!id || id.value !== 0x00) return null;
      pos += id.size;

      const protocol = readVarInt(chunk, pos);
      if (!protocol) return null;
      pos += protocol.size;

      const hostLen = readVarInt(chunk, pos);
      if (!hostLen) return null;
      pos += hostLen.size + hostLen.value + 2; // host + port

      const nextState = readVarInt(chunk, pos);
      return { protocol: protocol.value, nextState: nextState ? nextState.value : 1 };
    } catch (_) {
      return null;
    }
  }

  /** Answers the server-list ping so the entry shows our message. */
  _respondToPing(socket) {
    const status = this.getStatus?.() || {};
    const text = this.waking ? status.startingText : status.sleepingText;

    const payload = {
      version: { name: this.version || 'MineHost', protocol: -1 },
      players: { max: 0, online: 0, sample: [] },
      description: { text: text || this.motd },
    };

    try {
      socket.write(packet(0x00, stringField(JSON.stringify(payload))));
    } catch (_) {}

    // A client may follow with a ping payload it expects echoed back.
    socket.once('data', (data) => {
      try {
        if (data.length >= 10) socket.write(data);
      } catch (_) {}
      socket.end();
    });
    setTimeout(() => socket.destroy(), 1500);
  }

  /** Turns a join attempt into a readable disconnect message. */
  _reject(socket, protocol) {
    const status = this.getStatus?.() || {};
    const message = this.waking ? status.startingText : status.wakingText;
    const body = protocol >= 735
      ? JSON.stringify({ text: message })
      : JSON.stringify({ text: message });

    try {
      socket.write(packet(0x00, stringField(body)));
    } catch (_) {}
    setTimeout(() => socket.destroy(), 400);
  }

  async _wake() {
    if (this.waking) return;
    this.waking = true;

    this.onLog?.({
      line: 'Somebody tried to join; starting the server.',
      level: 'system', ts: Date.now(),
    });

    await this.stop();
    try {
      await this.onWake();
    } finally {
      this.waking = false;
    }
  }

  /** Counts down to a shutdown once the last player leaves. */
  armIdle(minutes, onIdle) {
    clearTimeout(this.idleTimer);
    if (!minutes || minutes < 1) return;
    this.idleMinutes = minutes;
    this.idleTimer = setTimeout(() => onIdle(), minutes * 60000);
  }

  cancelIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}

module.exports = WakeOnDemand;
