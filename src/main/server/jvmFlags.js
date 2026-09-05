/**
 * JVM tuning for a Minecraft server.
 *
 * These are Aikar's flags: a widely used G1GC configuration that trades a
 * little throughput for far shorter garbage-collection pauses, which is what
 * players actually feel as lag. They only pay off above 4 GB, where the
 * collector has room to work, so a smaller heap just gets the size arguments.
 */

/**
 * @param {number} ramGb  Maximum heap, in gigabytes.
 * @returns {string[]}    Arguments to pass before -jar.
 */
function jvmFlags(ramGb) {
  const base = [`-Xms${Math.max(1, Math.floor(ramGb / 2))}G`, `-Xmx${ramGb}G`];
  if (ramGb < 4) return base;

  // Larger heaps want a bigger young generation and coarser regions.
  const roomy = ramGb >= 12;

  return base.concat([
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=200',
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+DisableExplicitGC',
    '-XX:+AlwaysPreTouch',
    `-XX:G1NewSizePercent=${roomy ? 40 : 30}`,
    `-XX:G1MaxNewSizePercent=${roomy ? 50 : 40}`,
    `-XX:G1HeapRegionSize=${roomy ? 16 : 8}M`,
    '-XX:G1ReservePercent=15',
    '-XX:G1HeapWastePercent=5',
    '-XX:G1MixedGCCountTarget=4',
    '-XX:InitiatingHeapOccupancyPercent=20',
    '-XX:G1MixedGCLiveThresholdPercent=90',
    '-XX:G1RSetUpdatingPauseTimePercent=5',
    '-XX:SurvivorRatio=32',
    '-XX:+PerfDisableSharedMem',
    '-XX:MaxTenuringThreshold=1',
    '-Dusing.aikars.flags=https://mcflags.emc.gs',
    '-Daikars.new.flags=true',
  ]);
}

module.exports = { jvmFlags };
