/**
 * Human-facing catalogue of server.properties and gamerules, grouped the way a
 * player thinks about them rather than the way the file stores them.
 */

const PROPERTY_GROUPS = [
  {
    id: 'juego',
    title: 'cat.group.juego',
    hint: 'cat.group.juego.hint',
    items: [
      { key: 'gamemode', label: 'cat.gamemode', type: 'select', default: 'survival',
        options: [
          ['survival', 'cat.opt.survival'], ['creative', 'cat.opt.creative'],
          ['adventure', 'cat.opt.adventure'], ['spectator', 'cat.opt.spectator'],
        ] },
      { key: 'difficulty', label: 'cat.difficulty', type: 'select', default: 'easy',
        options: [
          ['peaceful', 'cat.opt.peaceful'], ['easy', 'cat.opt.easy'],
          ['normal', 'cat.opt.normal'], ['hard', 'cat.opt.hard'],
        ] },
      { key: 'hardcore', label: 'cat.hardcore', type: 'bool', default: 'false',
        help: 'cat.hardcore.help' },
      { key: 'pvp', label: 'cat.pvp', type: 'bool', default: 'true' },
      { key: 'force-gamemode', label: 'cat.force-gamemode', type: 'bool', default: 'false',
        help: 'cat.force-gamemode.help' },
      { key: 'allow-flight', label: 'cat.allow-flight', type: 'bool', default: 'false',
        help: 'cat.allow-flight.help' },
      { key: 'allow-nether', label: 'cat.allow-nether', type: 'bool', default: 'true' },
      { key: 'spawn-monsters', label: 'cat.spawn-monsters', type: 'bool', default: 'true' },
      { key: 'spawn-animals', label: 'cat.spawn-animals', type: 'bool', default: 'true' },
      { key: 'spawn-npcs', label: 'cat.spawn-npcs', type: 'bool', default: 'true' },
      { key: 'spawn-protection', label: 'cat.spawn-protection', type: 'number', default: '16',
        min: 0, max: 1000, unit: 'cat.unit.bloques',
        help: 'cat.spawn-protection.help' },
      { key: 'player-idle-timeout', label: 'cat.player-idle-timeout', type: 'number', default: '0',
        min: 0, max: 3600, unit: 'cat.unit.min', help: 'cat.player-idle-timeout.help' },
    ],
  },
  {
    id: 'mundo',
    title: 'cat.group.mundo',
    hint: 'cat.group.mundo.hint',
    items: [
      { key: 'level-name', label: 'cat.level-name', type: 'text', default: 'world',
        help: 'cat.level-name.help' },
      { key: 'level-seed', label: 'cat.level-seed', type: 'text', default: '',
        placeholder: 'cat.level-seed.placeholder', help: 'cat.level-seed.help' },
      { key: 'level-type', label: 'cat.level-type', type: 'select', default: 'minecraft:normal',
        options: [
          ['minecraft:normal', 'cat.opt.normal'], ['minecraft:flat', 'cat.opt.flat'],
          ['minecraft:large_biomes', 'cat.opt.large_biomes'], ['minecraft:amplified', 'cat.opt.amplified'],
          ['minecraft:single_biome_surface', 'cat.opt.single_biome_surface'],
        ] },
      { key: 'generate-structures', label: 'cat.generate-structures', type: 'bool', default: 'true',
        help: 'cat.generate-structures.help' },
      { key: 'max-world-size', label: 'cat.max-world-size', type: 'number', default: '29999984',
        min: 1, max: 29999984, unit: 'cat.unit.bloques' },
    ],
  },
  {
    id: 'acceso',
    title: 'cat.group.acceso',
    hint: 'cat.group.acceso.hint',
    items: [
      { key: 'motd', label: 'cat.motd', type: 'text', default: 'A Minecraft Server',
        help: 'cat.motd.help' },
      { key: 'max-players', label: 'cat.max-players', type: 'number', default: '20', min: 1, max: 1000 },
      { key: 'online-mode', label: 'cat.online-mode', type: 'bool', default: 'true',
        help: 'cat.online-mode.help' },
      { key: 'white-list', label: 'cat.white-list', type: 'bool', default: 'false',
        help: 'cat.white-list.help' },
      { key: 'enforce-whitelist', label: 'cat.enforce-whitelist', type: 'bool', default: 'false' },
      { key: 'enforce-secure-profile', label: 'cat.enforce-secure-profile', type: 'bool', default: 'true',
        help: 'cat.enforce-secure-profile.help' },
      { key: 'hide-online-players', label: 'cat.hide-online-players', type: 'bool', default: 'false' },
      { key: 'server-port', label: 'cat.server-port', type: 'number', default: '25565', min: 1024, max: 65535,
        help: 'cat.server-port.help' },
    ],
  },
  {
    id: 'rendimiento',
    title: 'cat.group.rendimiento',
    hint: 'cat.group.rendimiento.hint',
    items: [
      { key: 'view-distance', label: 'cat.view-distance', type: 'number', default: '10',
        min: 3, max: 32, unit: 'cat.unit.chunks', help: 'cat.view-distance.help' },
      { key: 'simulation-distance', label: 'cat.simulation-distance', type: 'number', default: '10',
        min: 3, max: 32, unit: 'cat.unit.chunks', help: 'cat.simulation-distance.help' },
      { key: 'entity-broadcast-range-percentage', label: 'cat.entity-broadcast-range-percentage', type: 'number',
        default: '100', min: 10, max: 500, unit: 'cat.unit.x' },
      { key: 'network-compression-threshold', label: 'cat.network-compression-threshold', type: 'number',
        default: '256', min: -1, max: 4096, unit: 'cat.unit.bytes' },
      { key: 'pause-when-empty-seconds', label: 'cat.pause-when-empty-seconds', type: 'number', default: '60',
        min: 0, max: 3600, unit: 'cat.unit.seg', help: 'cat.pause-when-empty-seconds.help' },
      { key: 'sync-chunk-writes', label: 'cat.sync-chunk-writes', type: 'bool', default: 'true',
        help: 'cat.sync-chunk-writes.help' },
    ],
  },
  {
    id: 'recursos',
    title: 'cat.group.recursos',
    hint: 'cat.group.recursos.hint',
    items: [
      { key: 'resource-pack', label: 'cat.resource-pack', type: 'text', default: '',
        placeholder: 'cat.resource-pack.placeholder' },
      { key: 'resource-pack-sha1', label: 'cat.resource-pack-sha1', type: 'text', default: '',
        help: 'cat.resource-pack-sha1.help' },
      { key: 'resource-pack-prompt', label: 'cat.resource-pack-prompt', type: 'text', default: '' },
      { key: 'require-resource-pack', label: 'cat.require-resource-pack', type: 'bool', default: 'false',
        help: 'cat.require-resource-pack.help' },
    ],
  },
  {
    id: 'avanzado',
    title: 'cat.group.avanzado',
    hint: 'cat.group.avanzado.hint',
    advanced: true,
    items: [
      { key: 'op-permission-level', label: 'cat.op-permission-level', type: 'number', default: '4', min: 1, max: 4 },
      { key: 'function-permission-level', label: 'cat.function-permission-level', type: 'number', default: '2', min: 1, max: 4 },
      { key: 'broadcast-console-to-ops', label: 'cat.broadcast-console-to-ops', type: 'bool', default: 'true' },
      { key: 'log-ips', label: 'cat.log-ips', type: 'bool', default: 'true' },
      { key: 'prevent-proxy-connections', label: 'cat.prevent-proxy-connections', type: 'bool', default: 'false',
        help: 'cat.prevent-proxy-connections.help' },
      { key: 'enable-command-block', label: 'cat.enable-command-block', type: 'bool', default: 'false' },
      { key: 'max-tick-time', label: 'cat.max-tick-time', type: 'number', default: '60000',
        min: -1, max: 600000, unit: 'cat.unit.ms', help: 'cat.max-tick-time.help' },
      { key: 'rate-limit', label: 'cat.rate-limit', type: 'number', default: '0', min: 0, max: 1000 },
    ],
  },
];

const GAMERULE_GROUPS = [
  {
    id: 'jugador',
    title: 'cat.group.jugador',
    items: [
      { key: 'keepInventory', label: 'cat.keepInventory', type: 'bool', default: 'false' },
      { key: 'doImmediateRespawn', label: 'cat.doImmediateRespawn', type: 'bool', default: 'false' },
      { key: 'showDeathMessages', label: 'cat.showDeathMessages', type: 'bool', default: 'true' },
      { key: 'spawnRadius', label: 'cat.spawnRadius', type: 'number', default: '10', min: 0, max: 1000 },
      { key: 'naturalRegeneration', label: 'cat.naturalRegeneration', type: 'bool', default: 'true' },
    ],
  },
  {
    id: 'mundo',
    title: 'cat.group.mundo',
    items: [
      { key: 'doDaylightCycle', label: 'cat.doDaylightCycle', type: 'bool', default: 'true' },
      { key: 'doWeatherCycle', label: 'cat.doWeatherCycle', type: 'bool', default: 'true' },
      { key: 'doFireTick', label: 'cat.doFireTick', type: 'bool', default: 'true' },
      { key: 'mobGriefing', label: 'cat.mobGriefing', type: 'bool', default: 'true',
        help: 'cat.mobGriefing.help' },
      { key: 'doMobSpawning', label: 'cat.doMobSpawning', type: 'bool', default: 'true' },
      { key: 'randomTickSpeed', label: 'cat.randomTickSpeed', type: 'number', default: '3', min: 0, max: 4096,
        help: 'cat.randomTickSpeed.help' },
      { key: 'doInsomnia', label: 'cat.doInsomnia', type: 'bool', default: 'true' },
      { key: 'doPatrolSpawning', label: 'cat.doPatrolSpawning', type: 'bool', default: 'true' },
      { key: 'doTraderSpawning', label: 'cat.doTraderSpawning', type: 'bool', default: 'true' },
    ],
  },
  {
    id: 'progreso',
    title: 'cat.group.progreso',
    items: [
      { key: 'doMobLoot', label: 'cat.doMobLoot', type: 'bool', default: 'true' },
      { key: 'doTileDrops', label: 'cat.doTileDrops', type: 'bool', default: 'true' },
      { key: 'doEntityDrops', label: 'cat.doEntityDrops', type: 'bool', default: 'true' },
      { key: 'announceAdvancements', label: 'cat.announceAdvancements', type: 'bool', default: 'true' },
      { key: 'keepInventoryOnDimensionChange', label: 'cat.keepInventoryOnDimensionChange', type: 'bool', default: 'true' },
      { key: 'fallDamage', label: 'cat.fallDamage', type: 'bool', default: 'true' },
      { key: 'fireDamage', label: 'cat.fireDamage', type: 'bool', default: 'true' },
      { key: 'drowningDamage', label: 'cat.drowningDamage', type: 'bool', default: 'true' },
    ],
  },
  {
    id: 'servidor',
    title: 'cat.group.servidor',
    items: [
      { key: 'sendCommandFeedback', label: 'cat.sendCommandFeedback', type: 'bool', default: 'true' },
      { key: 'commandBlockOutput', label: 'cat.commandBlockOutput', type: 'bool', default: 'true' },
      { key: 'logAdminCommands', label: 'cat.logAdminCommands', type: 'bool', default: 'true' },
      { key: 'reducedDebugInfo', label: 'cat.reducedDebugInfo', type: 'bool', default: 'false' },
      { key: 'playersSleepingPercentage', label: 'cat.playersSleepingPercentage', type: 'number',
        default: '100', min: 0, max: 100, unit: 'cat.unit.x',
        help: 'cat.playersSleepingPercentage.help' },
      { key: 'maxEntityCramming', label: 'cat.maxEntityCramming', type: 'number', default: '24', min: 0, max: 100 },
    ],
  },
];

/**
 * Swaps the i18n keys above for real text.
 *
 * The catalogue is stored as keys so it stays language-neutral; this resolves
 * them once, on the way to the renderer, which then receives plain strings and
 * needs to know nothing about how they were stored.
 *
 * @param {(key: string) => string} t  Translator for the active language.
 */
function localise(t) {
  const item = (i) => ({
    ...i,
    label: t(i.label),
    ...(i.help ? { help: t(i.help) } : {}),
    ...(i.unit ? { unit: t(i.unit) } : {}),
    ...(i.placeholder ? { placeholder: t(i.placeholder) } : {}),
    ...(i.options ? { options: i.options.map(([value, label]) => [value, t(label)]) } : {}),
  });

  const group = (g) => ({
    ...g,
    title: t(g.title),
    ...(g.hint ? { hint: t(g.hint) } : {}),
    items: g.items.map(item),
  });

  return {
    properties: PROPERTY_GROUPS.map(group),
    gamerules: GAMERULE_GROUPS.map(group),
  };
}

module.exports = { PROPERTY_GROUPS, GAMERULE_GROUPS, localise };
