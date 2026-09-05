/**
 * Modrinth integration. No API key required, but the terms ask for an
 * identifying User-Agent and a courteous request rate.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const API = 'https://api.modrinth.com/v2';
const UA = 'MineHost/1.0 (https://github.com/minehost)';

/* Loaders that accept plain plugins rather than mods. */
const PLUGIN_LOADERS = new Set(['paper', 'purpur', 'spigot', 'bukkit']);

function request(urlPath) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `${API}${urlPath}`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' } },
      (res) => {
        if (res.statusCode === 429) {
          res.resume();
          return reject(new Error('MODRINTH_RATE_LIMITED'));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`MODRINTH_HTTP:${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch (err) { reject(err); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(12000, () => req.destroy(new Error('MODRINTH_UNREACHABLE')));
  });
}

function download(url, dest, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('TOO_MANY_REDIRECTS'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        file.close();
        fs.rmSync(dest, { force: true });
        return resolve(download(new URL(res.headers.location, url).toString(), dest, onProgress, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        file.close();
        fs.rmSync(dest, { force: true });
        return reject(new Error(`DOWNLOAD_HTTP:${res.statusCode}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let done = 0;
      res.on('data', (c) => {
        done += c.length;
        if (total) onProgress?.(Math.round((done / total) * 100));
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
    }).on('error', (err) => {
      file.close();
      fs.rmSync(dest, { force: true });
      reject(err);
    });
  });
}

function sha1(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

/* The categories worth offering. Modrinth has more, but these are the ones a
   server owner actually browses by, and a short list beats an exhaustive one. */
const CATEGORIES = [
  'adventure', 'cursed', 'decoration', 'economy', 'equipment', 'food',
  'game-mechanics', 'library', 'magic', 'management', 'minigame', 'mobs',
  'optimization', 'social', 'storage', 'technology', 'transportation', 'utility',
  'worldgen',
];

/* Modrinth's sort keys, named the way the interface talks about them. */
const SORTS = ['relevance', 'downloads', 'follows', 'newest', 'updated'];

async function search({
  query = '', loader, gameVersion, projectType, offset = 0, limit = 20,
  categories = [], sort, environment, anyVersion = false,
}) {
  const type = projectType || (PLUGIN_LOADERS.has(loader) ? 'plugin' : 'mod');
  const facets = [[`project_type:${type}`]];
  if (loader) facets.push([`categories:${loader}`]);
  // Pinning the game version is the sane default, but a user hunting for a mod
  // that has not been tagged yet needs a way out of it.
  if (gameVersion && !anyVersion) facets.push([`versions:${gameVersion}`]);

  // Several categories at once read as "any of these", which is how a person
  // expects a filter list to behave.
  const picked = categories.filter((c) => CATEGORIES.includes(c));
  if (picked.length) facets.push(picked.map((c) => `categories:${c}`));

  // A dedicated server only ever runs the server half, so "required" and
  // "optional" both count as usable; only "unsupported" is dead weight.
  if (environment === 'server') facets.push(['server_side:required', 'server_side:optional']);
  if (environment === 'client') facets.push(['server_side:unsupported']);

  const index = SORTS.includes(sort) ? sort : (query ? 'relevance' : 'downloads');

  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    index,
    facets: JSON.stringify(facets),
  });
  if (query) params.set('query', query);

  const data = await request(`/search?${params}`);
  return {
    total: data.total_hits,
    offset,
    limit,
    hits: (data.hits || []).map((h) => ({
      id: h.project_id,
      slug: h.slug,
      title: h.title,
      description: h.description,
      author: h.author,
      downloads: h.downloads,
      follows: h.follows,
      updated: h.date_modified,
      icon: h.icon_url,
      categories: h.categories,
      versions: h.versions,
      latestVersion: h.latest_version,
      clientOnly: h.client_side === 'required' && h.server_side === 'unsupported',
      serverSide: h.server_side,
    })),
  };
}

/** Picks the newest file for a project matching this loader and game version. */
async function resolveVersion(projectId, loader, gameVersion) {
  const params = new URLSearchParams({
    loaders: JSON.stringify([loader]),
    game_versions: JSON.stringify([gameVersion]),
  });
  let versions = await request(`/project/${projectId}/version?${params}`);

  if (!versions.length) {
    // Some projects (datapack-style or loader-agnostic) omit the loader facet.
    versions = await request(
      `/project/${projectId}/version?game_versions=${encodeURIComponent(JSON.stringify([gameVersion]))}`
    );
  }
  if (!versions.length) return null;

  const release = versions.find((v) => v.version_type === 'release') || versions[0];
  const file = release.files.find((f) => f.primary) || release.files[0];
  if (!file) return null;

  return {
    versionId: release.id,
    name: release.name,
    versionNumber: release.version_number,
    filename: file.filename,
    url: file.url,
    sha1: file.hashes?.sha1 || null,
    dependencies: (release.dependencies || []).filter(
      (d) => d.dependency_type === 'required' && d.project_id
    ),
  };
}

/**
 * Installs a project and everything it requires. Dependencies are resolved
 * breadth-first; anything already present on disk is left alone.
 */
async function install({ projectId, loader, gameVersion, targetDir, onProgress }) {
  fs.mkdirSync(targetDir, { recursive: true });

  const installed = [];
  const skipped = [];
  const seen = new Set();
  const queue = [{ id: projectId, isDependency: false }];

  while (queue.length) {
    const { id, isDependency } = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);

    const resolved = await resolveVersion(id, loader, gameVersion);
    if (!resolved) {
      if (!isDependency) {
        return { ok: false, error: `NO_COMPATIBLE_VERSION:${loader} ${gameVersion}` };
      }
      skipped.push(id);
      continue;
    }

    const dest = path.join(targetDir, resolved.filename);
    if (fs.existsSync(dest) || fs.existsSync(`${dest}.disabled`)) {
      skipped.push(resolved.filename);
    } else {
      onProgress?.({ label: `Descargando ${resolved.filename}`, percent: 0 });
      await download(resolved.url, dest, (p) =>
        onProgress?.({ label: `Descargando ${resolved.filename}`, percent: p })
      );

      if (resolved.sha1 && sha1(dest) !== resolved.sha1) {
        fs.rmSync(dest, { force: true });
        return { ok: false, error: `DOWNLOAD_CORRUPT:${resolved.filename}` };
      }
      installed.push(resolved.filename);
    }

    for (const dep of resolved.dependencies) {
      queue.push({ id: dep.project_id, isDependency: true });
    }
  }

  return { ok: true, installed, skipped };
}

async function project(idOrSlug) {
  const p = await request(`/project/${idOrSlug}`);
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    body: p.body,
    downloads: p.downloads,
    icon: p.icon_url,
    serverSide: p.server_side,
    clientSide: p.client_side,
    source: p.source_url,
    wiki: p.wiki_url,
  };
}

module.exports = { search, install, project, resolveVersion, PLUGIN_LOADERS, CATEGORIES, SORTS };
