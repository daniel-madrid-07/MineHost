/**
 * Searching and installing content from Modrinth.
 */

const modrinth = require('../modrinth');
const { send, handle, currentServer } = require('../context');

handle('modrinth:search', ({ query, offset, filters = {} }) => {
  const { settings, info } = currentServer();
  return modrinth.search({
    query,
    offset,
    loader: info.platform || settings.platform,
    gameVersion: info.minecraft || settings.minecraft,
    categories: filters.categories,
    sort: filters.sort,
    environment: filters.environment,
    anyVersion: filters.anyVersion,
  });
});

handle('modrinth:facets', () => ({
  categories: modrinth.CATEGORIES,
  sorts: modrinth.SORTS,
}));

handle('modrinth:install', async (projectId) => {
  const { settings, info } = currentServer();
  const dir = contentDir(settings, info);
  if (!dir) return { ok: false, error: 'PLATFORM_NO_MODS' };
  return modrinth.install({
    projectId,
    loader: info.platform || settings.platform,
    gameVersion: info.minecraft || settings.minecraft,
    targetDir: dir,
    onProgress: (p) => send('task:progress', p),
  });
});
