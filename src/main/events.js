/**
 * Turns raw server output into the handful of moments worth watching: who came
 * and went, what they achieved, how they died, and what the world is doing.
 *
 * The console already shows everything; this is the opposite, a quiet feed of
 * things a person actually cares about.
 */

/* Minecraft prefixes every line with a timestamp and thread. */
const STRIP = /^\[[\d:]+\]\s*\[[^\]]+\]:\s*/;

const NAME = '[A-Za-z0-9_]{1,16}';

/**
 * Death messages are many and version-dependent, so they are matched by the
 * verbs that only ever appear in one. Anchoring on a player name at the start
 * keeps chat lines and mod chatter out.
 */
const DEATH_VERBS = [
  'was slain by', 'was shot by', 'was killed by', 'was blown up by',
  'was fireballed by', 'was pricked to death', 'was squashed by', 'was impaled by',
  'was skewered by', 'was struck by lightning', 'was squished too much',
  'was poked to death by', 'was roasted in dragon(?:\'s)? breath', 'was stung to death',
  'was obliterated by', 'was doomed to fall', 'was burnt to a crisp',
  'was frozen to death', 'was killed', 'went off with a bang',
  'drowned', 'blew up', 'burned to death', 'starved to death', 'suffocated in a wall',
  'fell out of the world', 'fell from a high place', 'fell off', 'fell into',
  'hit the ground too hard', 'died', 'withered away', 'experienced kinetic energy',
  'discovered the floor was lava', 'walked into danger zone', 'walked into fire',
  'went up in flames', 'tried to swim in lava', 'froze to death',
  'was pummeled by', 'was speared by', 'left the confines of this world',
];

const PATTERNS = [
  { kind: 'join', re: new RegExp(`^(${NAME}) joined the game$`) },
  { kind: 'leave', re: new RegExp(`^(${NAME}) left the game$`) },

  // Advancement, challenge and goal all read the same to a player.
  { kind: 'advancement',
    re: new RegExp(`^(${NAME}) has made the advancement \\[(.+)\\]$`) },
  { kind: 'challenge',
    re: new RegExp(`^(${NAME}) has completed the challenge \\[(.+)\\]$`) },
  { kind: 'goal',
    re: new RegExp(`^(${NAME}) has reached the goal \\[(.+)\\]$`) },

  { kind: 'chat', re: new RegExp(`^<(${NAME})>\\s(.+)$`) },
  { kind: 'me', re: new RegExp(`^\\* (${NAME}) (.+)$`) },

  { kind: 'sleep',
    re: /^(\d+) player(?:s)? (?:is|are) sleeping|Sleeping through this night|players sleeping/i },

  { kind: 'op', re: new RegExp(`^Made (${NAME}) a server operator$`) },
  { kind: 'deop', re: new RegExp(`^Made (${NAME}) no longer a server operator$`) },
  { kind: 'ban', re: new RegExp(`^Banned (${NAME}):?\\s*(.*)$`) },
  { kind: 'kick', re: new RegExp(`^Kicked (${NAME}):?\\s*(.*)$`) },
  { kind: 'whitelistAdd', re: new RegExp(`^Added (${NAME}) to the whitelist$`) },
  { kind: 'whitelistRemove', re: new RegExp(`^Removed (${NAME}) from the whitelist$`) },

  { kind: 'ready', re: /^Done \(([\d.]+)s\)!/ },
  { kind: 'stopping', re: /^Stopping the server$/ },
  { kind: 'saved', re: /^Saved the game$/ },
  { kind: 'overloaded', re: /Can't keep up!.*Running (\d+)ms.*behind/ },
  { kind: 'worldPrepared', re: /^Preparing spawn area: 100%$/ },
];

const deathRe = new RegExp(`^(${NAME}) (${DEATH_VERBS.join('|')})\\b(.*)$`, 'i');

/**
 * Extracts one event from a console line, or null when the line is routine.
 * `level` lets errors through as their own kind of moment.
 */
function parse(line, level) {
  const text = String(line).replace(STRIP, '').trim();
  if (!text) return null;

  for (const { kind, re } of PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;

    if (kind === 'chat' || kind === 'me') {
      return { kind, player: m[1], text: m[2] };
    }
    if (kind === 'advancement' || kind === 'challenge' || kind === 'goal') {
      return { kind, player: m[1], text: m[2] };
    }
    if (kind === 'sleep') {
      return { kind, text };
    }
    if (kind === 'overloaded') {
      return { kind, text, ms: parseInt(m[1], 10) };
    }
    if (kind === 'ready') {
      return { kind, text, seconds: parseFloat(m[1]) };
    }
    return { kind, player: m[1] || null, text: m[2] || text };
  }

  const death = deathRe.exec(text);
  if (death) {
    return { kind: 'death', player: death[1], text };
  }

  if (level === 'error') return { kind: 'error', text };

  return null;
}

module.exports = { parse };
