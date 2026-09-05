import { $, S, api, el, icon } from '../core/dom.js';
import { closeMenus } from './console-shortcuts.js';
import { compactNumber, emptyState, taskEnd, taskStart, toast } from '../ui/feedback.js';
import { t } from '../core/i18n.js';
import { wireTabs } from '../ui/navigation.js';

let searchTimer = null;

/* What the user has narrowed the catalogue down to. Declared before anything
   can trigger a search, since wiring the tabs may fire one immediately. */
const MR = {
  query: '',
  sort: 'relevance',
  categories: new Set(),
  environment: 'server',   // a dedicated server is the whole point of the app
  anyVersion: false,
  offset: 0,
  total: 0,
  facets: null,
};

wireTabs('contentTabs', (tab) => {
  // Show something useful the first time the tab is opened, before any typing.
  if (tab === 'buscar' && !$('mrResults').childElementCount) runSearch({ reset: true });
});

const ENVIRONMENTS = ['any', 'server', 'client'];

$('mrQuery').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  MR.query = e.target.value.trim();
  searchTimer = setTimeout(() => runSearch({ reset: true }), 320);
});

/** Fills the three filter menus once, from what the backend offers. */
async function buildFilterMenus() {
  if (MR.facets) return;
  MR.facets = await api.modrinth.facets();

  const sortList = $('mrSortList');
  sortList.innerHTML = '';
  for (const key of MR.facets.sorts) {
    const b = el('button', null, t(`mods.sort.${key}`));
    b.type = 'button';
    b.dataset.sort = key;
    sortList.append(b);
  }

  const catList = $('mrCategoryList');
  catList.innerHTML = '';
  for (const key of MR.facets.categories) {
    const b = el('button', null, t(`mods.cat.${key}`));
    b.type = 'button';
    b.dataset.category = key;
    catList.append(b);
  }

  const envList = $('mrEnvList');
  envList.innerHTML = '';
  for (const key of ENVIRONMENTS) {
    const b = el('button', null, t(`mods.env.${key}`));
    b.type = 'button';
    b.dataset.env = key;
    envList.append(b);
  }

  syncFilterUi();
}

/** Reflects the current filter state on the triggers and the menu items. */
function syncFilterUi() {
  $('mrSortValue').textContent = t(`mods.sort.${MR.sort}`);
  $('mrEnvValue').textContent = t(`mods.env.${MR.environment}`);

  const n = MR.categories.size;
  $('mrCategoryValue').textContent = n === 0
    ? t('mods.cat.all')
    : n === 1
      ? t(`mods.cat.${[...MR.categories][0]}`)
      : t('mods.cat.several', { n });

  document.querySelectorAll('#mrSortList button').forEach((b) =>
    b.classList.toggle('is-on', b.dataset.sort === MR.sort));
  document.querySelectorAll('#mrEnvList button').forEach((b) =>
    b.classList.toggle('is-on', b.dataset.env === MR.environment));
  document.querySelectorAll('#mrCategoryList button').forEach((b) =>
    b.classList.toggle('is-on', MR.categories.has(b.dataset.category)));

  $('mrAnyVersion').checked = MR.anyVersion;

  // The reset button only earns its place once something is actually filtered.
  const dirty = MR.sort !== 'relevance' || MR.categories.size > 0
    || MR.environment !== 'server' || MR.anyVersion;
  $('mrClear').hidden = !dirty;
}

$('mrFilters').addEventListener('click', (e) => {
  const trigger = e.target.closest('.menu-trigger');
  if (trigger) {
    const menu = trigger.closest('.menu');
    const wasOpen = menu.classList.contains('open');
    closeMenus();
    if (!wasOpen) menu.classList.add('open');
    return;
  }

  const item = e.target.closest('.menu-list button');
  if (!item) return;

  if (item.dataset.sort) {
    MR.sort = item.dataset.sort;
    closeMenus();
  } else if (item.dataset.env) {
    MR.environment = item.dataset.env;
    closeMenus();
  } else if (item.dataset.category) {
    // Categories stack, so this menu stays open while the user picks.
    const key = item.dataset.category;
    if (MR.categories.has(key)) MR.categories.delete(key);
    else MR.categories.add(key);
  } else return;

  syncFilterUi();
  runSearch({ reset: true });
});

$('mrAnyVersion').addEventListener('change', (e) => {
  MR.anyVersion = e.target.checked;
  syncFilterUi();
  runSearch({ reset: true });
});

$('mrClear').addEventListener('click', () => {
  MR.sort = 'relevance';
  MR.categories.clear();
  MR.environment = 'server';
  MR.anyVersion = false;
  syncFilterUi();
  runSearch({ reset: true });
});

$('mrMore').addEventListener('click', () => runSearch({ reset: false }));

/** Builds one result row. */
function modrinthRow(hit) {
  const row = el('div', 'row');

  const ico = el('div', 'row-icon');
  if (hit.icon) {
    const img = document.createElement('img');
    img.src = hit.icon;
    img.loading = 'lazy';
    img.alt = '';
    ico.append(img);
  } else ico.append(icon('mods'));

  const main = el('div', 'row-main');
  main.append(el('div', 'row-title', hit.title));
  main.append(el('span', 'row-sub', hit.description));

  const meta = el('div', 'row-meta');
  meta.append(el('span', 'num', t('mods.downloads', { n: compactNumber(hit.downloads) })));
  if (hit.categories?.length) {
    // Only the first couple, otherwise the row turns into a tag soup.
    for (const c of hit.categories.slice(0, 2)) {
      if (MR.facets?.categories.includes(c)) {
        meta.append(el('span', 'badge-mini', t(`mods.cat.${c}`)));
      }
    }
  }
  main.append(meta);

  const actions = el('div', 'row-actions');
  if (hit.serverSide === 'unsupported') {
    const warn = el('span', 'badge-mini warn', t('mods.clientOnly'));
    warn.title = t('mods.clientOnlyHint');
    actions.append(warn);
  }
  const add = el('button', 'btn btn-quiet btn-sm', t('mods.install'));
  add.addEventListener('click', async () => {
    add.disabled = true;
    add.textContent = t('mods.installing');
    taskStart(t('mods.installing'));
    const r = await api.modrinth.install(hit.id);
    taskEnd();
    if (r.ok) {
      add.textContent = t('mods.installed');
      add.classList.add('is-on');
      const extra = r.installed.length - 1;
      toast(extra > 0
        ? t('mods.installedDeps', { name: hit.title, n: extra })
        : t('mods.installedOk', { name: hit.title }));
    } else {
      add.disabled = false;
      add.textContent = t('mods.install');
      toast(r.error, 'error');
    }
  });
  actions.append(add);

  row.append(ico, main, actions);
  return row;
}

async function runSearch({ reset = true } = {}) {
  const box = $('mrResults');
  if (!S.info.installed) {
    emptyState(box, 'search', t('mods.searchFirst'), t('mods.searchFirstHint'));
    $('mrMore').hidden = true;
    return;
  }

  await buildFilterMenus();

  if (reset) {
    MR.offset = 0;
    box.innerHTML = '';
    for (let i = 0; i < 4; i++) box.append(el('div', 'skeleton'));
  }
  $('mrMore').hidden = true;

  const filters = {
    categories: [...MR.categories],
    sort: MR.sort,
    environment: MR.environment,
    anyVersion: MR.anyVersion,
  };

  const res = await api.modrinth.search(MR.query, MR.offset, filters);

  if (res.error) {
    if (reset) emptyState(box, 'warn', t('mods.searchFailed'), res.error);
    else toast(res.error, 'error');
    return;
  }

  if (reset) box.innerHTML = '';

  if (!res.hits?.length) {
    if (reset) {
      emptyState(box, 'search', t('mods.noResults'),
        MR.anyVersion
          ? t('mods.noResultsPlain')
          : t('mods.noResultsHint', { version: S.info.minecraft || '' }));
    }
    return;
  }

  for (const hit of res.hits) box.append(modrinthRow(hit));

  MR.total = res.total;
  MR.offset += res.hits.length;
  $('mrMore').hidden = MR.offset >= MR.total;
}
