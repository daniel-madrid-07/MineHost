/**
 * The patterns that turn a server's console output into facts we can act on.
 *
 * Minecraft has no machine-readable status channel, so watching stdout is the
 * only way to know a server is ready, who joined, or why it died. Keeping the
 * expressions here means the manager reads as logic rather than as regex.
 */

const READY = /Done \(([\d.]+)s\)!/i;
const JOIN = /:\s*([A-Za-z0-9_]{1,16}) joined the game/i;
const LEAVE = /:\s*([A-Za-z0-9_]{1,16}) left the game/i;
const CHAT = /:\s*<([A-Za-z0-9_]{1,16})>\s*(.+)$/;
const SAVED = /Saved the game|ThreadedAnvilChunkStorage.*complete|Saving.*chunks/i;

/* Failures worth naming, because each needs a different answer from the user. */
const EULA = /You need to agree to the EULA/i;
const PORT = /Perhaps a server is already running|address already in use|FAILED TO BIND/i;
/* A missing or mismatched mod dependency never fixes itself on a retry. */
const MODS = /Missing or unsupported mandatory dependencies|requires .* or above|ModLoadingException/i;

/* Forge-likes answer /forge tps; Paper-likes answer /tps. */
const TPS_FORGE = /Overall\s*:?\s*Mean tick time:\s*([\d.]+)\s*ms\.?\s*Mean TPS:\s*([\d.]+)/i;
const TPS_DIM = /Mean tick time:\s*([\d.]+)\s*ms\.?\s*Mean TPS:\s*([\d.]+)/i;
const TPS_PAPER = /TPS from last 1m, 5m, 15m:\s*\*?([\d.]+)/i;

/**
 * The command that asks for tick rate, which differs by platform. NeoForge
 * renamed the root from `forge` to `neoforge`, so the two cannot share one.
 */
function tpsCommand(platform) {
  if (platform === 'neoforge') return 'neoforge tps';
  if (platform === 'forge') return 'forge tps';
  if (platform === 'paper' || platform === 'purpur') return 'tps';
  return null;
}

/** Reads a tick rate out of one line, whichever dialect produced it. */
function readTps(line) {
  const forge = line.match(TPS_FORGE) || line.match(TPS_DIM);
  if (forge) return { tps: Number(forge[2]), mspt: Number(forge[1]) };

  const paper = line.match(TPS_PAPER);
  if (paper) return { tps: Number(paper[1]), mspt: null };

  return null;
}

/** Classifies a crash so the caller knows whether retrying is pointless. */
function crashReason(recentOutput) {
  if (EULA.test(recentOutput)) return 'eula';
  if (PORT.test(recentOutput)) return 'port';
  if (MODS.test(recentOutput)) return 'mods';
  return 'unknown';
}

module.exports = {
  READY, JOIN, LEAVE, CHAT, SAVED, EULA, PORT, MODS,
  tpsCommand, readTps, crashReason,
};
