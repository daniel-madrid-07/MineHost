/**
 * Server platforms. Each one knows how to list its versions and how to put a
 * runnable server on disk — either a plain jar or an installer we must run.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const UA = 'MineHost/1.0 (https://github.com/minehost)';

function getJson(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('Demasiadas redirecciones'));
    https.get(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(getJson(new URL(res.headers.location, url).toString(), redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} en ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (err) { reject(err); }
      });
    }).on('error', reject);
  });
}

function getText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

/**
 * Sorts Minecraft versions newest first. Handles both the historic "1.x.y"
 * scheme and the newer year-based "26.x" one, which must rank above 1.x.
 */
function compareMc(a, b) {
  const parse = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  }
  return 0;
}

const isRelease = (v) => /^\d+\.\d+(\.\d+)?$/.test(v);

/* ------------------------------- NeoForge -------------------------------- */

async function neoforgeVersions() {
  const data = await getJson(
    'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'
  );
  const all = Array.isArray(data) ? data : data.versions || [];

  const byMc = new Map();
  for (const v of all) {
    const m = /^(\d+)\.(\d+)\./.exec(v);
    if (!m) continue;
    const major = parseInt(m[1], 10);
    // NeoForge mirrors the Minecraft version: 21.10.x -> 1.21.10, but the
    // year-based scheme (26.x) drops the historic "1." prefix.
    const mc = major >= 26 ? `${major}.${m[2]}` : `1.${major}.${m[2]}`;
    if (!byMc.has(mc)) byMc.set(mc, { stable: [], pre: [] });
    (/beta|alpha|rc/i.test(v) ? byMc.get(mc).pre : byMc.get(mc).stable).push(v);
  }

  // Several Minecraft versions only ever got beta builds; offering nothing at
  // all for them is worse than offering the beta, so fall back to it.
  return [...byMc.entries()]
    .map(([minecraft, { stable, pre }]) => {
      const pool = stable.length ? stable : pre;
      return {
        minecraft,
        build: pool.sort((a, b) => compareMc(b, a))[0],
        prerelease: !stable.length,
      };
    })
    .sort((a, b) => compareMc(a.minecraft, b.minecraft));
}

/* --------------------------------- Forge --------------------------------- */

async function forgeVersions() {
  const data = await getJson(
    'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'
  );
  // Prefer the recommended build, but keep "latest" for versions that never
  // got one — otherwise those Minecraft versions disappear from the list.
  const recommended = new Map();
  const latest = new Map();

  for (const [key, build] of Object.entries(data.promos || {})) {
    const m = /^(.+?)-(recommended|latest)$/.exec(key);
    if (!m || !isRelease(m[1])) continue;
    (m[2] === 'recommended' ? recommended : latest).set(m[1], build);
  }

  const versions = new Set([...recommended.keys(), ...latest.keys()]);
  return [...versions]
    .map((minecraft) => ({
      minecraft,
      build: recommended.get(minecraft) || latest.get(minecraft),
      prerelease: !recommended.has(minecraft),
    }))
    .sort((a, b) => compareMc(a.minecraft, b.minecraft));
}

/* -------------------------------- Vanilla -------------------------------- */

async function vanillaVersions() {
  const data = await getJson('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
  return data.versions
    .filter((v) => v.type === 'release')
    .map((v) => ({ minecraft: v.id, build: v.id, _url: v.url }));
}

async function vanillaJarUrl(version, manifestUrl) {
  let url = manifestUrl;
  if (!url) {
    const data = await getJson('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
    url = data.versions.find((v) => v.id === version)?.url;
  }
  if (!url) throw new Error(`Versión ${version} no encontrada`);
  const meta = await getJson(url);
  if (!meta.downloads?.server?.url) throw new Error(`La versión ${version} no tiene servidor oficial`);
  return meta.downloads.server.url;
}

/* --------------------------------- Paper --------------------------------- */

async function paperVersions(project = 'paper') {
  const data = await getJson(`https://fill.papermc.io/v3/projects/${project}`);
  // v3 groups versions by family: { "1.21": ["1.21.10", "1.21.9", ...], ... }
  const flat = Object.values(data.versions || {}).flat();
  return flat
    .filter(isRelease)
    .map((v) => ({ minecraft: v, build: 'latest' }))
    .sort((a, b) => compareMc(a.minecraft, b.minecraft));
}

async function paperJarUrl(version, project = 'paper') {
  const builds = await getJson(
    `https://fill.papermc.io/v3/projects/${project}/versions/${version}/builds`
  );
  const stable = builds.filter((b) => b.channel === 'STABLE');
  const chosen = (stable.length ? stable : builds)[0];
  const download = chosen?.downloads?.['server:default'];
  if (!download?.url) throw new Error(`No hay builds de ${project} para ${version}`);
  return { url: download.url, build: String(chosen.id) };
}

/* -------------------------------- Purpur --------------------------------- */

async function purpurVersions() {
  const data = await getJson('https://api.purpurmc.org/v2/purpur');
  return (data.versions || [])
    .filter(isRelease)
    .map((v) => ({ minecraft: v, build: 'latest' }))
    .sort((a, b) => compareMc(a.minecraft, b.minecraft));
}

/* -------------------------------- Fabric --------------------------------- */

async function fabricVersions() {
  const games = await getJson('https://meta.fabricmc.net/v2/versions/game');
  return games
    .filter((g) => g.stable)
    .map((g) => ({ minecraft: g.version, build: 'loader' }));
}

async function fabricJarUrl(version) {
  const loaders = await getJson(`https://meta.fabricmc.net/v2/versions/loader/${version}`);
  const loader = loaders.find((l) => l.loader.stable) || loaders[0];
  if (!loader) throw new Error(`Fabric no soporta ${version}`);
  const installers = await getJson('https://meta.fabricmc.net/v2/versions/installer');
  const installer = installers.find((i) => i.stable) || installers[0];
  return {
    url: `https://meta.fabricmc.net/v2/versions/loader/${version}/${loader.loader.version}/${installer.version}/server/jar`,
    build: loader.loader.version,
  };
}

/* ------------------------------- Registry -------------------------------- */

const PLATFORMS = {
  neoforge: {
    id: 'neoforge',
    name: 'NeoForge',
    kind: 'mods',
    blurb: 'La opción moderna para mods. Tus amigos necesitan los mismos mods instalados.',
    modsDir: 'mods',
    install: 'installer',
    versions: neoforgeVersions,
    installerUrl: (mc, build) =>
      `https://maven.neoforged.net/releases/net/neoforged/neoforge/${build}/neoforge-${build}-installer.jar`,
  },
  forge: {
    id: 'forge',
    name: 'Forge',
    kind: 'mods',
    blurb: 'El clásico para mods, con el catálogo más amplio en versiones antiguas.',
    modsDir: 'mods',
    install: 'installer',
    versions: forgeVersions,
    installerUrl: (mc, build) =>
      `https://maven.minecraftforge.net/net/minecraftforge/forge/${mc}-${build}/forge-${mc}-${build}-installer.jar`,
  },
  fabric: {
    id: 'fabric',
    name: 'Fabric',
    kind: 'mods',
    blurb: 'Ligero y rápido de actualizar. Muy usado para mods de rendimiento.',
    modsDir: 'mods',
    install: 'jar',
    versions: fabricVersions,
    jarUrl: (mc) => fabricJarUrl(mc),
  },
  paper: {
    id: 'paper',
    name: 'Paper',
    kind: 'plugins',
    blurb: 'Máximo rendimiento con plugins. Tus amigos entran sin instalar nada.',
    modsDir: 'plugins',
    install: 'jar',
    versions: () => paperVersions('paper'),
    jarUrl: (mc) => paperJarUrl(mc, 'paper'),
  },
  purpur: {
    id: 'purpur',
    name: 'Purpur',
    kind: 'plugins',
    blurb: 'Paper con cientos de ajustes extra de jugabilidad. También con plugins.',
    modsDir: 'plugins',
    install: 'jar',
    versions: purpurVersions,
    jarUrl: async (mc) => ({
      url: `https://api.purpurmc.org/v2/purpur/${mc}/latest/download`,
      build: 'latest',
    }),
  },
  vanilla: {
    id: 'vanilla',
    name: 'Vanilla',
    kind: 'vanilla',
    blurb: 'Minecraft puro, sin mods ni plugins. Lo más simple y estable.',
    modsDir: null,
    install: 'jar',
    versions: vanillaVersions,
    jarUrl: async (mc) => ({ url: await vanillaJarUrl(mc), build: mc }),
  },
};

const cache = new Map();

async function listVersions(platformId) {
  const platform = PLATFORMS[platformId];
  if (!platform) throw new Error(`Plataforma desconocida: ${platformId}`);

  const hit = cache.get(platformId);
  if (hit && Date.now() - hit.at < 15 * 60 * 1000) return hit.data;

  const data = await platform.versions();
  cache.set(platformId, { at: Date.now(), data });
  return data;
}

function meta() {
  return Object.values(PLATFORMS).map(({ id, name, kind, blurb, modsDir }) => ({
    id, name, kind, blurb, modsDir,
  }));
}

module.exports = { PLATFORMS, listVersions, meta, getJson, getText, compareMc };
