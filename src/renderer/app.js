const api = window.mh;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const icon = (name) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ic');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
};

const S = {
  settings: {},
  server: null,          // active server entry
  servers: [],
  info: {},
  meta: {},
  state: { status: 'stopped', players: [] },
  tunnel: { status: 'stopped', address: null },
  net: {},
  view: 'panel',
  uptimeTimer: null,
  props: {},
  propsDirty: {},
  playerTab: 'ops',
  players: { ops: [], whitelist: [], bans: [], ipBans: [] },
  strings: {},
  lang: 'en',
  events: [],
};

/* ------------------------------ Localisation ------------------------------ */

/** Looks up a string and fills {placeholders}. Falls back to the key itself. */
function t(key, vars) {
  let out = S.strings[key];
  if (out == null) return key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

/** Re-renders every static string marked up in the HTML. */
function applyStrings() {
  document.querySelectorAll('[data-i18n]').forEach((n) => {
    n.textContent = t(n.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-ph]').forEach((n) => {
    n.placeholder = t(n.dataset.i18nPh);
  });
  document.documentElement.lang = S.lang;
}

/* -------------------------------- Feedback -------------------------------- */

function toast(msg, kind = 'ok') {
  const t = el('div', `toast ${kind === 'ok' ? '' : kind}`);
  t.append(el('span', null, msg));
  $('toasts').appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity 180ms, transform 180ms';
    t.style.opacity = '0';
    t.style.transform = 'translateX(10px)';
    setTimeout(() => t.remove(), 200);
  }, 4200);
}

let taskDepth = 0;
function taskStart(title) {
  taskDepth++;
  $('taskTitle').textContent = title;
  $('taskText').textContent = '';
  $('taskBar').style.width = '0%';
  $('task').hidden = false;
}
function taskEnd() {
  taskDepth = Math.max(0, taskDepth - 1);
  if (!taskDepth) $('task').hidden = true;
}

api.app.onProgress(({ label, percent, indeterminate }) => {
  if ($('task').hidden) return;
  if (label) $('taskText').textContent = label;
  const bar = $('taskBar');
  if (indeterminate) {
    bar.style.width = '38%';
    bar.style.opacity = '0.55';
  } else {
    bar.style.opacity = '1';
    bar.style.width = `${percent || 0}%`;
  }
});

function confirmAsk(title, text, danger = 'Continuar') {
  return new Promise((resolve) => {
    $('cfTitle').textContent = title;
    $('cfText').textContent = text;
    $('cfYes').textContent = danger;
    $('confirm').hidden = false;

    const done = (v) => {
      $('confirm').hidden = true;
      $('cfYes').removeEventListener('click', yes);
      $('cfNo').removeEventListener('click', no);
      resolve(v);
    };
    const yes = () => done(true);
    const no = () => done(false);
    $('cfYes').addEventListener('click', yes);
    $('cfNo').addEventListener('click', no);
  });
}

const fmtSize = (b) =>
  b > 1073741824 ? `${(b / 1073741824).toFixed(1)} GB`
  : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB`
  : `${Math.max(1, Math.round(b / 1024))} KB`;

const fmtDate = (ms) => new Date(ms).toLocaleString(S.lang, {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
});

function emptyState(parent, iconName, title, sub, action) {
  parent.innerHTML = '';
  const e = el('div', 'empty');
  e.append(icon(iconName), el('b', null, title), el('span', null, sub));
  if (action) {
    const b = el('button', 'btn btn-quiet btn-sm', action.label);
    b.addEventListener('click', action.onClick);
    e.append(b);
  }
  parent.append(e);
}

/* ------------------------------- Navigation ------------------------------- */

function go(view) {
  S.view = view;
  document.querySelectorAll('.nav-item').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) =>
    v.classList.toggle('active', v.id === `view-${view}`));

  if (view === 'contenido') refreshMods();
  if (view === 'jugadores') refreshPlayers();
  if (view === 'copias') refreshBackups();
  if (view === 'mundo') refreshWorlds();
  if (view === 'archivos') openFolder(S.filePath);
  if (view === 'actividad') renderEventFeed(S.events);
}

$('nav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
  if (btn) go(btn.dataset.view);
});

function wireTabs(containerId, onChange) {
  const box = $(containerId);
  box.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    box.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    const pane = tab.dataset.tab;
    const scope = box.closest('.view');
    scope.querySelectorAll('.tabpane').forEach((p) =>
      p.classList.toggle('active', p.id === `tab-${pane}`));
    onChange?.(pane);
  });
}

/* -------------------------------- Console --------------------------------- */

const consoleEl = $('console');
let logFilterText = '';

function addLog({ line, level }) {
  const atBottom = consoleEl.scrollHeight - consoleEl.scrollTop - consoleEl.clientHeight < 70;
  const row = el('div', `ln ${level || 'info'}`, line);
  if (logFilterText && !line.toLowerCase().includes(logFilterText)) row.classList.add('hidden-row');
  consoleEl.appendChild(row);
  while (consoleEl.childElementCount > 1500) consoleEl.firstElementChild.remove();
  if (atBottom) consoleEl.scrollTop = consoleEl.scrollHeight;
}

api.server.onLog(addLog);
api.ngrok.onLog(({ line, level }) => addLog({ line: `[${t('console.tunnelPrefix')}] ${line}`, level }));

$('logFilter').addEventListener('input', (e) => {
  logFilterText = e.target.value.trim().toLowerCase();
  consoleEl.querySelectorAll('.ln').forEach((n) =>
    n.classList.toggle('hidden-row', logFilterText && !n.textContent.toLowerCase().includes(logFilterText)));
});

$('btnClearLog').addEventListener('click', () => { consoleEl.innerHTML = ''; });

$('cmdForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('cmdInput');
  const cmd = input.value.trim();
  if (!cmd) return;
  const r = await api.server.command(cmd);
  if (!r.ok) toast(r.error, 'error');
  input.value = '';
});

/* ------------------------------ Server state ------------------------------ */

const statusLabel = (k) => t(`status.${k}`);

function renderServer() {
  const { status, players, startedAt } = S.state;
  const platform = S.meta.platforms?.find((p) => p.id === (S.info.platform || S.server?.platform));

  $('stState').textContent = statusLabel(status);
  $('stPlayers').textContent = players.length;
  $('stPlatform').textContent = S.info.installed
    ? `${platform?.name || '—'} · ${S.info.minecraft || '—'}`
    : '—';

  const pipClass = status === 'running' ? 'running' : status === 'stopped' ? '' : 'starting';
  $('chipPip').className = `pip ${pipClass}`;
  $('chipTitle').textContent = S.server?.name || 'MineHost';
  $('chipSub').textContent = !S.server
    ? t('servers.empty')
    : S.info.installed
      ? `${S.info.minecraft || ''} · ${statusLabel(status)}`
      : t('servers.notInstalled');

  $('tbStatus').hidden = status === 'stopped';
  $('tbStatusText').textContent = statusLabel(status);
  $('tbStatus').querySelector('.pip').className = `pip ${pipClass}`;

  const btn = $('btnPower');
  btn.disabled = status === 'starting' || status === 'stopping' || !S.info.installed;
  $('btnPowerText').textContent =
    status === 'stopped' ? t('panel.powerStart')
    : status === 'running' ? t('panel.powerStop')
    : statusLabel(status);
  btn.className = `btn ${status === 'stopped' ? 'btn-primary' : 'btn-quiet'}`;

  const list = $('onlineList');
  $('onlineCount').textContent = players.length;
  list.innerHTML = '';
  if (!players.length) {
    list.append(el('span', 't-sm ink-subtle',
      status === 'running' ? t('panel.nobody') : t('panel.serverOff')));
  } else {
    for (const p of players) {
      const tag = el('div', 'player-tag');
      tag.append(el('span', 'pip'), el('span', null, p));
      const kick = el('button', 'btn btn-quiet btn-sm', t('panel.kick'));
      kick.addEventListener('click', async () => {
        await api.players.kick(p, t('players.kickReason'));
        toast(t('players.kicked', { name: p }));
      });
      tag.append(kick);
      list.append(tag);
    }
  }

  clearInterval(S.uptimeTimer);
  if (status === 'running' && startedAt) {
    const tick = () => {
      const sec = Math.floor((Date.now() - startedAt) / 1000);
      const pad = (n) => String(n).padStart(2, '0');
      $('stUptime').textContent =
        `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;
    };
    tick();
    S.uptimeTimer = setInterval(tick, 1000);
  } else {
    $('stUptime').textContent = '—';
  }

  $('meterRam').hidden = status !== 'running';
  $('meterCpu').hidden = status !== 'running';
  if (status !== 'running') {
    $('ramBar').style.width = '0%';
    $('cpuBar').style.width = '0%';
  }
}

/** The address card depends on how this server is exposed. */
function renderTunnel() {
  const mode = S.server?.exposure || 'tunnel';
  const { status, address } = S.tunnel;
  const tag = $('tunnelTag');

  let shown = null;
  let hint = '';

  if (mode === 'tunnel') {
    tag.hidden = false;
    tag.textContent = status === 'running' ? t('panel.tunnelLive')
      : status === 'starting' ? t('panel.tunnelOpening')
      : t('panel.tunnelNone');
    tag.className = `tag ${status === 'running' ? 'live' : ''}`;
    shown = address;
    hint = address ? t('panel.addressHintTunnel')
      : S.server?.ngrokToken ? t('panel.addressHintStart')
      : t('panel.addressHintToken');
  } else if (mode === 'portforward') {
    tag.hidden = true;
    const port = S.server?.port || 25565;
    shown = S.net.publicIp ? `${S.net.publicIp}:${port}` : null;
    hint = t('panel.addressHintForward');
  } else {
    tag.hidden = true;
    const port = S.server?.port || 25565;
    shown = S.net.localIp ? `${S.net.localIp}:${port}` : null;
    hint = t('panel.addressHintLan');
  }

  $('addrPublic').textContent = shown || '—';
  $('btnCopyPublic').disabled = !shown;
  $('addrHint').textContent = hint;
}

api.server.onState((st) => { S.state = st; renderServer(); });
api.ngrok.onState((s) => { S.tunnel = s; renderTunnel(); });

api.server.onStats(({ ramMb, cpuPercent }) => {
  $('ramValue').textContent = ramMb > 1024 ? `${(ramMb / 1024).toFixed(1)} GB` : `${ramMb} MB`;
  const ramPct = Math.min(100, Math.round((ramMb / 1024 / (S.server?.ramGb || 4)) * 100));
  const rb = $('ramBar');
  rb.style.width = `${ramPct}%`;
  rb.className = ramPct > 90 ? 'hot' : ramPct > 75 ? 'warn' : '';
  if (cpuPercent != null) {
    $('cpuValue').textContent = `${cpuPercent.toFixed(0)} %`;
    const cb = $('cpuBar');
    cb.style.width = `${Math.min(100, cpuPercent)}%`;
    cb.className = cpuPercent > 90 ? 'hot' : cpuPercent > 70 ? 'warn' : '';
  }
});

api.server.onCrash(({ reason }) => {
  if (reason === 'port') {
    toast(t('access.forwardClosed', { port: S.server?.port || 25565 }), 'error');
  } else if (reason === 'eula') {
    toast('EULA', 'error');
  } else {
    toast(t('status.stopped'), 'error');
  }
});

/* -------------------------------- Power ---------------------------------- */

$('btnPower').addEventListener('click', async () => {
  if (S.state.status === 'running') {
    taskStart(t('panel.powerStop'));
    const r = await api.server.stop();
    taskEnd();
    if (!r.ok) toast(r.error, 'error');
    return;
  }

  go('consola');
  const r = await api.server.start();
  if (!r.ok) { toast(r.error, 'error'); return; }

  if (S.server?.autoTunnel) {
    if (!S.server?.ngrokToken) {
      toast(t('panel.addressHintToken'), 'warn');
      return;
    }
    const t = await api.ngrok.start(25565);
    if (!t.ok) toast(`Túnel: ${t.error}`, 'error');
  }
});

$('btnCopyPublic').addEventListener('click', async () => {
  if (!S.tunnel.address) return;
  await navigator.clipboard.writeText(S.tunnel.address);
  toast(t('common.copied'));
});
$('btnCopyLocal').addEventListener('click', async () => {
  await navigator.clipboard.writeText('localhost');
  toast(t('common.copied'));
});
$('btnOpenFolder').addEventListener('click', () => {
  if (S.server?.serverPath) api.shell.openPath(S.server?.serverPath);
});

/* --------------------------------- Mods ---------------------------------- */

async function refreshMods() {
  const box = $('modList');
  if (!S.info.installed) {
    emptyState(box, 'mods', t('mods.noServer'), t('mods.noServerHint'),
      { label: t('nav.settings'), onClick: () => go('ajustes') });
    return;
  }

  const res = await api.mods.list();
  const isPlugins = res.kind === 'plugins';
  $('contentTitle').textContent = t(isPlugins ? 'mods.titlePlugins' : 'mods.title');
  document.querySelector('[data-label="contenido"]').textContent =
    t(isPlugins ? 'nav.plugins' : 'nav.mods');
  $('dropTitle').textContent = t(isPlugins ? 'mods.dropPlugins' : 'mods.drop');
  $('contentSub').textContent = t(isPlugins ? 'mods.subtitlePlugins' : 'mods.subtitle');

  if (!res.supported) {
    emptyState(box, 'mods', t('mods.vanillaTitle'), t('mods.vanillaHint'));
    return;
  }
  if (!res.items.length) {
    emptyState(box, 'mods', t('mods.empty'), t('mods.emptyHint'));
    return;
  }

  box.innerHTML = '';
  for (const m of res.items) {
    const row = el('div', `row ${m.enabled ? '' : 'off'}`);
    const main = el('div', 'row-main');
    main.append(el('span', 'row-title', m.name.replace(/\.jar$/, '')));
    main.append(el('span', 'row-sub', fmtSize(m.size)));

    const actions = el('div', 'row-actions');
    const toggle = el('button', 'btn btn-quiet btn-sm', m.enabled ? t('mods.disable') : t('mods.enable'));
    toggle.addEventListener('click', async () => { await api.mods.toggle(m.file); refreshMods(); });

    const del = el('button', 'btn btn-quiet btn-sm btn-icon');
    del.title = t('common.delete');
    del.append(icon('trash'));
    del.addEventListener('click', async () => {
      if (!await confirmAsk(t('mods.deleteTitle'), t('mods.deleteText', { name: m.name }), t('common.delete'))) return;
      await api.mods.remove(m.file);
      refreshMods();
      toast(t('mods.deleted'));
    });

    actions.append(toggle, del);
    row.append(main, actions);
    box.append(row);
  }
}

$('btnAddJars').addEventListener('click', async () => {
  const files = await api.dialog.pickJars();
  if (!files.length) return;
  const r = await api.mods.add(files);
  if (r.ok) { toast(t('mods.added', { n: r.added })); refreshMods(); }
  else toast(r.error, 'error');
});
$('btnOpenMods').addEventListener('click', () => api.mods.openFolder());

/** `exts` may be null to accept any file, as the file browser does. */
function wireDrop(zone, exts, onFiles) {
  ['dragenter', 'dragover'].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
  zone.addEventListener('drop', (e) => {
    const paths = [...e.dataTransfer.files]
      .map((f) => api.pathForFile(f))
      .filter((p) => p && (!exts || exts.some((x) => p.toLowerCase().endsWith(x))));
    if (!paths.length) {
      return toast(exts ? t('mods.onlyJar', { ext: exts.join(', ') }) : t('files.badName'), 'warn');
    }
    onFiles(paths);
  });
}

wireDrop($('modDrop'), ['.jar'], async (paths) => {
  const r = await api.mods.add(paths);
  if (r.ok) { toast(t('mods.added', { n: r.added })); refreshMods(); }
  else toast(r.error, 'error');
});

/* -------------------------------- Modrinth -------------------------------- */

wireTabs('contentTabs', (tab) => {
  // Show something useful the first time the tab is opened, before any typing.
  if (tab === 'buscar' && !$('mrResults').childElementCount) runSearch('');
});

let searchTimer = null;
$('mrQuery').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  searchTimer = setTimeout(() => runSearch(q), 320);
});

async function runSearch(query) {
  const box = $('mrResults');
  if (!S.info.installed) {
    emptyState(box, 'search', t('mods.searchFirst'), t('mods.searchFirstHint'));
    return;
  }

  box.innerHTML = '';
  for (let i = 0; i < 4; i++) box.append(el('div', 'skeleton'));

  const res = await api.modrinth.search(query, 0);
  if (res.error) { emptyState(box, 'warn', t('mods.searchFailed'), res.error); return; }
  if (!res.hits?.length) {
    emptyState(box, 'search', t('mods.noResults'),
      t('mods.noResultsHint', { version: S.info.minecraft || '' }));
    return;
  }

  box.innerHTML = '';
  for (const hit of res.hits) {
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
    const titleRow = el('div', 'row-title', hit.title);
    main.append(titleRow);
    main.append(el('span', 'row-sub', hit.description));

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
    box.append(row);
  }
}

/* -------------------------------- Players --------------------------------- */

wireTabs('playerTabs', (tab) => { S.playerTab = tab; renderPlayers(); });

const PLAYER_COPY = {
  ops:       { hint: 'Los operadores pueden usar todos los comandos.', ph: 'Nombre de Minecraft' },
  whitelist: { hint: 'Con la lista blanca activa, solo estos jugadores pueden entrar.', ph: 'Nombre de Minecraft' },
  bans:      { hint: 'Los jugadores expulsados no pueden volver a entrar.', ph: 'Nombre de Minecraft' },
  ipBans:    { hint: 'Bloquea una dirección IP concreta.', ph: '192.168.1.20' },
};

async function refreshPlayers() {
  if (!S.server?.serverPath) return;
  S.players = await api.players.read(S.server?.serverPath);
  renderPlayers();
}

function renderPlayers() {
  const tab = S.playerTab;
  $('plHint').textContent = PLAYER_COPY[tab].hint;
  $('plInput').placeholder = PLAYER_COPY[tab].ph;

  const box = $('plList');
  const items = S.players[tab] || [];
  if (!items.length) {
    emptyState(box, 'players', t('players.empty'),
      tab === 'ops' ? 'Añade tu propio nombre para poder usar comandos en el juego.'
                    : 'Añade jugadores con el campo de arriba.');
    return;
  }

  box.innerHTML = '';
  for (const entry of items) {
    const label = entry.name || entry.ip;
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.append(el('span', 'row-title', label));
    if (entry.reason) main.append(el('span', 'row-sub', entry.reason));
    else if (entry.level) main.append(el('span', 'row-sub', t('players.level', { n: entry.level })));

    const del = el('button', 'btn btn-quiet btn-sm',
      tab === 'bans' || tab === 'ipBans' ? t('players.unban') : t('players.remove'));
    del.addEventListener('click', async () => {
      const r = await api.players.mutate(tab, 'remove', label);
      if (r.ok) { toast(t('players.removed', { name: label })); setTimeout(refreshPlayers, 400); }
      else toast(r.error, 'error');
    });

    const actions = el('div', 'row-actions');
    actions.append(del);
    row.append(main, actions);
    box.append(row);
  }
}

async function addPlayer() {
  const input = $('plInput');
  const value = input.value.trim();
  if (!value) return;
  $('plAdd').disabled = true;
  const r = await api.players.mutate(S.playerTab, 'add', value);
  $('plAdd').disabled = false;
  if (r.ok) {
    input.value = '';
    toast(t('players.added', { name: value }));
    setTimeout(refreshPlayers, 500);
  } else toast(r.error, 'error');
}
$('plAdd').addEventListener('click', addPlayer);
$('plInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addPlayer(); });

/* -------------------------------- Backups --------------------------------- */

async function refreshBackups() {
  if (!S.server?.serverPath) return;
  const box = $('backupList');
  const list = await api.backups.list(S.server?.serverPath);

  if (!list.length) {
    emptyState(box, 'backup', t('backups.empty'),
      'Crea una antes de instalar mods nuevos o de tocar el mundo.',
      { label: t('backups.emptyCta'), onClick: () => $('btnBackupNow').click() });
    return;
  }

  box.innerHTML = '';
  for (const b of list) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.append(el('span', 'row-title', fmtDate(b.created)));
    main.append(el('span', 'row-sub', `${fmtSize(b.size)} · ${b.file}`));

    const restore = el('button', 'btn btn-quiet btn-sm', t('backups.restore'));
    restore.addEventListener('click', async () => {
      if (!await confirmAsk(t('backups.restoreTitle'), t('backups.restoreText'), t('backups.restore'))) return;
      taskStart(t('backups.restoring'));
      const r = await api.backups.restore(b.file);
      taskEnd();
      if (r.ok) toast(t('backups.restored'));
      else toast(r.error, 'error');
      refreshBackups();
    });

    const del = el('button', 'btn btn-quiet btn-sm btn-icon');
    del.title = t('common.delete');
    del.append(icon('trash'));
    del.addEventListener('click', async () => {
      if (!await confirmAsk(t('backups.deleteTitle'), t('backups.deleteText'), t('common.delete'))) return;
      await api.backups.remove(b.file);
      refreshBackups();
    });

    const actions = el('div', 'row-actions');
    actions.append(restore, del);
    row.append(main, actions);
    box.append(row);
  }
}

$('btnBackupNow').addEventListener('click', async () => {
  taskStart(t('backups.creating'));
  const r = await api.backups.create('manual');
  taskEnd();
  if (r.ok) toast(t('backups.created', { size: fmtSize(r.size) }));
  else toast(r.error, 'error');
  refreshBackups();
});
$('btnOpenBackups').addEventListener('click', () => api.backups.openFolder());

/* --------------------------------- Worlds --------------------------------- */

wireTabs('worldTabs', (tab) => {
  if (tab === 'reglas') renderGamerules();
  if (tab === 'datapacks') refreshDatapacks();
});

async function refreshWorlds() {
  if (!S.server?.serverPath) return;
  const box = $('worldList');
  const list = await api.worlds.list();

  if (!list.length) {
    emptyState(box, 'world', t('world.empty'), t('world.emptyHint'));
    return;
  }

  box.innerHTML = '';
  for (const w of list) {
    const row = el('div', `row ${w.active ? 'active-row' : ''}`);
    const main = el('div', 'row-main');
    const title = el('span', 'row-title', w.name);
    main.append(title);
    const bits = [fmtSize(w.size)];
    if (w.hasNether) bits.push('Nether');
    if (w.hasEnd) bits.push('End');
    main.append(el('span', 'row-sub', bits.join(' · ')));

    const actions = el('div', 'row-actions');
    if (w.active) actions.append(el('span', 'badge-mini ok', t('world.active')));
    else {
      const use = el('button', 'btn btn-quiet btn-sm', t('world.use'));
      use.addEventListener('click', async () => {
        const r = await api.worlds.activate(w.name);
        if (r.ok) { toast(t('world.activated', { name: w.name })); refreshWorlds(); }
        else toast(r.error, 'error');
      });
      actions.append(use);
    }

    const exp = el('button', 'btn btn-quiet btn-sm btn-icon');
    exp.title = t('world.export');
    exp.append(icon('download'));
    exp.addEventListener('click', async () => {
      const dest = await api.dialog.saveZip(`${w.name}.zip`);
      if (!dest) return;
      taskStart(t('world.export'));
      const r = await api.worlds.export(w.name, dest);
      taskEnd();
      toast(r.ok ? t('world.exported') : r.error, r.ok ? 'ok' : 'error');
    });
    actions.append(exp);

    if (!w.active) {
      const del = el('button', 'btn btn-quiet btn-sm btn-icon');
      del.title = t('common.delete');
      del.append(icon('trash'));
      del.addEventListener('click', async () => {
        if (!await confirmAsk(t('world.deleteTitle'), t('world.deleteText', { name: w.name }), t('common.delete'))) return;
        const r = await api.worlds.remove(w.name);
        if (r.ok) { toast(t('world.movedAside')); refreshWorlds(); }
        else toast(r.error, 'error');
      });
      actions.append(del);
    }

    row.append(main, actions);
    box.append(row);
  }
}

$('btnImportWorld').addEventListener('click', async () => {
  const zip = await api.dialog.pickZip();
  if (!zip) return;
  const base = zip.split(/[\\/]/).pop().replace(/\.zip$/i, '');
  const r = await api.worlds.import(zip, base);
  if (r.ok) { toast(t('world.imported', { name: r.name })); refreshWorlds(); }
  else toast(r.error, 'error');
});

/* ------------------------------- Gamerules -------------------------------- */

function renderGamerules() {
  const box = $('rulesGroups');
  $('rulesNotice').hidden = S.state.status === 'running';
  if (box.dataset.built) return;
  box.dataset.built = '1';
  box.innerHTML = '';

  for (const group of S.meta.catalog.gamerules) {
    const card = el('article', 'card');
    const head = el('div', 'group-title');
    head.append(el('h3', null, group.title));
    card.append(head);

    for (const item of group.items) {
      card.append(optionRow(item, (value) => api.gamerules.set(item.key, value)));
    }
    box.append(card);
  }
}

/** Builds one labelled control; `onChange` receives the new value. */
function optionRow(item, onChange, initial) {
  const row = el('div', 'opt-row');
  const label = el('div', 'opt-label');
  label.append(el('b', null, item.label));
  if (item.help) label.append(el('span', null, item.help));

  const control = el('div', 'opt-control');
  const value = initial !== undefined ? initial : item.default;

  if (item.type === 'bool') {
    const wrap = el('label', 'switch');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = String(value) === 'true';
    input.addEventListener('change', () => onChange(String(input.checked)));
    wrap.append(input, el('i'));
    control.append(wrap);
  } else if (item.type === 'select') {
    const sel = document.createElement('select');
    for (const [v, label2] of item.options) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = label2;
      sel.append(opt);
    }
    sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value));
    control.append(sel);
  } else if (item.type === 'number') {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'num';
    if (item.min != null) input.min = item.min;
    if (item.max != null) input.max = item.max;
    input.value = value;
    input.addEventListener('change', () => onChange(input.value));
    control.append(input);
    if (item.unit) control.append(el('span', 'opt-unit', item.unit));
  } else {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value ?? '';
    if (item.placeholder) input.placeholder = item.placeholder;
    input.addEventListener('change', () => onChange(input.value));
    control.append(input);
  }

  row.append(label, control);
  return row;
}

/* ------------------------------- Datapacks -------------------------------- */

async function refreshDatapacks() {
  const box = $('dpList');
  const list = await api.datapacks.list();
  if (!list.length) {
    emptyState(box, 'world', t('world.noDatapacks'), t('world.noDatapacksHint'));
    return;
  }
  box.innerHTML = '';
  for (const d of list) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.append(el('span', 'row-title', d.name));
    main.append(el('span', 'row-sub', d.isFolder ? t('common.folder') : fmtSize(d.size)));
    const del = el('button', 'btn btn-quiet btn-sm btn-icon');
    del.append(icon('trash'));
    del.addEventListener('click', async () => {
      if (!await confirmAsk(t('world.datapackDeleteTitle'), t('world.datapackDeleteText', { name: d.name }), t('common.delete'))) return;
      await api.datapacks.remove(d.name);
      refreshDatapacks();
    });
    const actions = el('div', 'row-actions');
    actions.append(del);
    row.append(main, actions);
    box.append(row);
  }
}

wireDrop($('dpDrop'), ['.zip'], async (paths) => {
  const r = await api.datapacks.add(paths);
  if (r.ok) { toast(t('world.datapacksAdded', { n: r.added })); refreshDatapacks(); }
});

/* -------------------------------- Settings -------------------------------- */

wireTabs('settingsTabs', (tab) => { if (tab === 'opciones') renderProps(); });

$('btnPickFolder').addEventListener('click', async () => {
  const folder = await api.dialog.pickFolder();
  if (!folder) return;
  $('inpPath').value = folder;
  S.server = await api.servers.update(S.server.id, { serverPath: folder });
  await reloadActive();
});

async function loadPlatformVersions() {
  const platformId = $('selPlatform').value;
  const sel = $('selVersion');
  sel.innerHTML = `<option>${t('common.loading')}</option>`;
  sel.disabled = true;

  renderBetaHint();

  try {
    const versions = await api.installer.versions(platformId);
    fillVersions(sel, versions);
    sel.disabled = false;
  } catch (err) {
    sel.innerHTML = `<option>${t('common.offline')}</option>`;
    toast(t('common.versionsFailed'), 'error');
  }
}

/**
 * Fills a version dropdown, newest first and grouped by Minecraft family.
 * Beta builds are hidden unless the user asks for them, since picking one by
 * accident is a real way to end up with a broken world.
 */
function fillVersions(sel, versions) {
  const previous = sel.value;
  const showBeta = !!S.settings.showBetaVersions;
  const shown = showBeta ? versions : versions.filter((v) => !v.prerelease);

  sel.innerHTML = '';
  if (!shown.length) {
    sel.innerHTML = `<option>${t('common.noVersions')}</option>`;
    return;
  }

  let group = null;
  let currentFamily = null;

  for (const v of shown) {
    const parts = String(v.minecraft).split('.');
    // Historic versions group as 1.21.x; the year-based ones group by year.
    const family = parts[0] === '1' ? parts.slice(0, 2).join('.') : parts[0];
    if (family !== currentFamily) {
      currentFamily = family;
      group = document.createElement('optgroup');
      group.label = `Minecraft ${family}`;
      sel.append(group);
    }

    const opt = document.createElement('option');
    opt.value = JSON.stringify({ minecraft: v.minecraft, build: v.build });
    opt.textContent = v.prerelease
      ? `Minecraft ${v.minecraft} · ${t('versions.betaTag')}`
      : `Minecraft ${v.minecraft}`;
    if (v.prerelease) opt.className = 'opt-beta';
    group.append(opt);
  }

  // Keep the previous pick when it survives the filter.
  if (previous && [...sel.options].some((o) => o.value === previous)) sel.value = previous;
}

$('selPlatform').addEventListener('change', loadPlatformVersions);

$('cfgShowBeta').addEventListener('change', async (e) => {
  S.settings = await api.settings.set({ showBetaVersions: e.target.checked });
  renderBetaHint();
  loadPlatformVersions();
});

/** Warns only while betas are actually on offer. */
function renderBetaHint() {
  const hint = $('platformHint');
  const platform = S.meta.platforms?.find((p) => p.id === $('selPlatform').value);
  hint.textContent = S.settings.showBetaVersions
    ? t('versions.betaHint')
    : (platform?.blurb || '');
  hint.style.color = S.settings.showBetaVersions ? 'var(--warn)' : '';
}

$('inpServerName').addEventListener('change', async (e) => {
  const name = e.target.value.trim();
  if (!name || !S.server) return;
  S.server = await api.servers.update(S.server.id, { name });
  renderServer();
});

$('btnInstall').addEventListener('click', async () => {
  const serverPath = $('inpPath').value.trim();
  if (!serverPath) return toast(t('settings.needFolder'), 'warn');

  let choice;
  try { choice = JSON.parse($('selVersion').value); }
  catch (_) { return toast(t('settings.needVersion'), 'warn'); }

  if (S.info.installed && !await confirmAsk(t('settings.reinstallTitle'), t('settings.reinstallText'), t('settings.install'))) return;

  taskStart(t('wizard.installing'));
  const r = await api.installer.install({
    serverId: S.server?.id,
    serverPath,
    platformId: $('selPlatform').value,
    minecraft: choice.minecraft,
    build: choice.build,
  });
  taskEnd();

  if (r.ok === false) { toast(r.error, 'error'); return; }
  toast(t('settings.installed'));
  await reloadActive();
});

/* RAM: slider and number field mirror each other; the cap is the real RAM. */
function setRam(value) {
  const total = S.meta.totalRamGb || 8;
  const v = Math.max(1, Math.min(total, Math.round(value) || 1));
  $('ramRange').value = v;
  $('ramNumber').value = v;
  const warn = v > total - 2;
  $('ramHint').textContent = warn
    ? t('settings.memoryWarn', { total })
    : t('settings.memoryHint', { total });
  $('ramHint').style.color = warn ? 'var(--warn)' : '';
  return v;
}

$('ramRange').addEventListener('input', (e) => setRam(+e.target.value));
$('ramRange').addEventListener('change', async (e) => {
  S.server = await api.servers.update(S.server.id, { ramGb: setRam(+e.target.value) });
});
$('ramNumber').addEventListener('input', (e) => {
  const v = +e.target.value;
  if (v >= 1) $('ramRange').value = Math.min(v, S.meta.totalRamGb || 8);
});
$('ramNumber').addEventListener('change', async (e) => {
  S.server = await api.servers.update(S.server.id, { ramGb: setRam(+e.target.value) });
});

/* Toggles */
const bindToggle = (id, key) => {
  $(id).addEventListener('change', async (e) => {
    if (!S.server) return;
    S.server = await api.servers.update(S.server.id, { [key]: e.target.checked });
  });
};
bindToggle('cfgAutoRestart', 'autoRestartOnCrash');
bindToggle('cfgAutoTunnel', 'autoTunnel');
bindToggle('cfgBackupOnStop', 'backupOnStop');

$('cfgBackupsKeep').addEventListener('change', async (e) => {
  S.server = await api.servers.update(S.server.id, { backupsKeep: Math.max(1, +e.target.value || 10) });
});

async function saveSchedule() {
  if (!S.server) return;
  const schedule = {
    restart: { enabled: $('cfgRestartOn').checked, time: $('cfgRestartTime').value || '05:00' },
    backup: { enabled: $('cfgBackupAuto').checked, everyHours: Math.max(1, +$('cfgBackupHours').value || 6) },
  };
  S.server = await api.servers.update(S.server.id, { schedule });
  const info = await api.schedule.get();
  $('nextRestartHint').textContent = info.nextRestart
    ? t('settings.nextRestart', { when: fmtDate(info.nextRestart) })
    : '';
}

['cfgRestartOn', 'cfgRestartTime', 'cfgBackupAuto', 'cfgBackupHours']
  .forEach((id) => $(id).addEventListener('change', saveSchedule));

/* ------------------------------ ngrok token ------------------------------- */

$('btnNgrokSignup').addEventListener('click', () =>
  api.shell.openExternal('https://dashboard.ngrok.com/signup'));
$('btnNgrokToken').addEventListener('click', () =>
  api.shell.openExternal('https://dashboard.ngrok.com/get-started/your-authtoken'));

$('btnEyeToken').addEventListener('click', () => {
  const i = $('inpToken');
  const show = i.type === 'password';
  i.type = show ? 'text' : 'password';
  $('btnEyeToken').textContent = show ? 'Ocultar' : 'Ver';
});

$('btnSaveToken').addEventListener('click', async () => {
  const token = $('inpToken').value.trim();
  if (!token) return toast(t('access.tokenMissing'), 'warn');

  taskStart(t('access.preparing'));
  const ensured = await api.ngrok.ensure();
  if (ensured.ok === false) { taskEnd(); return toast(ensured.error, 'error'); }
  const r = await api.ngrok.setToken(token);
  taskEnd();

  if (!r.ok) {
    $('tokenHint').textContent = r.error;
    $('tokenHint').style.color = 'var(--danger)';
    return toast(r.error, 'error');
  }
  S.server = await api.servers.active();
  $('tokenHint').textContent = t('access.tokenVerified');
  $('tokenHint').style.color = 'var(--accent)';
  toast(t('access.tunnelReady'));
  renderTunnel();
});

/* ----------------------------- server.properties -------------------------- */

async function loadProps() {
  if (!S.server?.serverPath) return;
  S.props = await api.props.read(S.server?.serverPath);
  S.propsDirty = {};
  $('propGroups').dataset.built = '';
  if (document.querySelector('#tab-opciones.active')) renderProps();
}

function renderProps() {
  const box = $('propGroups');
  if (box.dataset.built) return;
  box.dataset.built = '1';
  box.innerHTML = '';

  for (const group of S.meta.catalog.properties) {
    const card = el('article', 'card');
    const head = el('div', 'group-title');
    head.append(el('h3', null, group.title));
    if (group.hint) head.append(el('span', 't-caption ink-subtle', group.hint));
    card.append(head);

    for (const item of group.items) {
      const current = S.props[item.key] ?? item.default;
      card.append(optionRow(item, (v) => { S.propsDirty[item.key] = v; }, current));
    }
    box.append(card);
  }
}

$('btnSaveProps').addEventListener('click', async () => {
  if (!S.server?.serverPath) return toast(t('settings.needFolder'), 'warn');
  if (!Object.keys(S.propsDirty).length) return toast(t('common.noChanges'));

  const r = await api.props.write(S.server?.serverPath, S.propsDirty);
  if (r.ok === false) return toast(r.error, 'error');

  Object.assign(S.props, S.propsDirty);
  S.propsDirty = {};
  toast(S.state.status === 'running' ? t('common.savedRestart') : t('common.saved'));
});


/* ------------------------------ Server picker ----------------------------- */

function promptText(title, value = '') {
  return new Promise((resolve) => {
    $('pmTitle').textContent = title;
    const input = $('pmInput');
    input.value = value;
    $('promptScrim').hidden = false;
    input.focus();
    input.select();

    const done = (v) => {
      $('promptScrim').hidden = true;
      $('pmYes').removeEventListener('click', yes);
      $('pmNo').removeEventListener('click', no);
      input.removeEventListener('keydown', key);
      resolve(v);
    };
    const yes = () => done(input.value.trim() || null);
    const no = () => done(null);
    const key = (e) => {
      if (e.key === 'Enter') yes();
      if (e.key === 'Escape') no();
    };
    $('pmYes').addEventListener('click', yes);
    $('pmNo').addEventListener('click', no);
    input.addEventListener('keydown', key);
  });
}

async function openPicker() {
  S.servers = await api.servers.list();
  const box = $('pkList');
  box.innerHTML = '';

  if (!S.servers.length) {
    emptyState(box, 'panel', t('servers.empty'), t('servers.emptyHint'));
  }

  for (const entry of S.servers) {
    const isCurrent = entry.id === S.settings.activeServerId;
    const row = el('div', `row pk-row ${isCurrent ? 'current' : ''}`);

    const main = el('div', 'row-main');
    main.append(el('span', 'row-title', entry.name));
    main.append(el('span', 'row-sub', entry.installed
      ? `${entry.minecraft || ''} · ${entry.serverPath}`
      : t('servers.notInstalled')));

    const actions = el('div', 'row-actions');

    if (!isCurrent) {
      const open = el('button', 'btn btn-quiet btn-sm', t('servers.open'));
      open.addEventListener('click', async (e) => {
        e.stopPropagation();
        const r = await api.servers.select(entry.id);
        if (!r.ok) return toast(t('servers.deleteText'), 'warn');
        $('pickerScrim').hidden = true;
        await reloadActive();
      });
      actions.append(open);
    } else {
      actions.append(el('span', 'badge-mini ok', t('world.active')));
    }

    const ren = el('button', 'btn btn-quiet btn-sm', t('servers.rename'));
    ren.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = await promptText(t('servers.renameTitle'), entry.name);
      if (!name) return;
      await api.servers.update(entry.id, { name });
      if (isCurrent) await reloadActive();
      openPicker();
    });

    const del = el('button', 'btn btn-quiet btn-sm btn-icon');
    del.append(icon('trash'));
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!await confirmAsk(t('servers.deleteTitle'), t('servers.deleteText'), t('common.delete'))) return;
      const r = await api.servers.remove(entry.id);
      if (r.ok === false) return toast(t('servers.deleteText'), 'warn');
      await reloadActive();
      openPicker();
    });

    actions.append(ren, del);
    row.append(main, actions);
    box.append(row);
  }

  $('pickerScrim').hidden = false;
}

$('serverSwitch').addEventListener('click', openPicker);
$('pkClose').addEventListener('click', () => { $('pickerScrim').hidden = true; });
$('pkNew').addEventListener('click', () => {
  $('pickerScrim').hidden = true;
  wizard.open();
});

/* ------------------------------ Access modes ------------------------------ */

function renderExposure() {
  const mode = S.server?.exposure || 'tunnel';
  document.querySelectorAll('#exposureModes .mode').forEach((b) =>
    b.classList.toggle('sel', b.dataset.mode === mode));

  $('paneTunnel').hidden = mode !== 'tunnel';
  $('paneForward').hidden = mode !== 'portforward';
  $('paneLan').hidden = mode !== 'lan';

  // Auto-tunnel only means anything when the tunnel is the chosen route.
  const autoRow = $('cfgAutoTunnel')?.closest('.switch-row');
  if (autoRow) autoRow.hidden = mode !== 'tunnel';

  if (mode === 'portforward' || mode === 'lan') refreshNetwork();
  renderTunnel();
}

async function refreshNetwork() {
  S.net = await api.network.summary();
  const port = S.server?.port || 25565;

  $('fwStep1Hint').textContent = t('access.forwardStep1Hint', { ip: S.net.localIp || '—' });
  $('fwStep2Hint').textContent = t('access.forwardStep2Hint', { port, ip: S.net.localIp || '—' });
  $('routerUrl').textContent = S.net.gateway || '192.168.1.1';
  $('fwPublicAddr').textContent = S.net.publicIp ? `${S.net.publicIp}:${port}` : '—';
  $('lanAddr').textContent = S.net.localIp ? `${S.net.localIp}:${port}` : '—';
  $('cgnatNotice').hidden = !S.net.cgnat;
  $('inpPort').value = port;

  renderTunnel();
}

$('exposureModes').addEventListener('click', async (e) => {
  const btn = e.target.closest('.mode');
  if (!btn || !S.server) return;
  S.server = await api.servers.update(S.server.id, { exposure: btn.dataset.mode });
  renderExposure();
});

$('btnOpenRouter').addEventListener('click', () => {
  if (S.net.gateway) api.shell.openExternal(`http://${S.net.gateway}`);
});

$('btnNetRefresh').addEventListener('click', refreshNetwork);

$('btnCopyForward').addEventListener('click', async () => {
  const v = $('fwPublicAddr').textContent;
  if (v && v !== '—') { await navigator.clipboard.writeText(v); toast(t('common.copied')); }
});

$('btnCopyLan').addEventListener('click', async () => {
  const v = $('lanAddr').textContent;
  if (v && v !== '—') { await navigator.clipboard.writeText(v); toast(t('common.copied')); }
});

$('inpPort').addEventListener('change', async (e) => {
  const port = Math.max(1024, Math.min(65535, +e.target.value || 25565));
  e.target.value = port;
  S.server = await api.servers.update(S.server.id, { port });
  refreshNetwork();
});

$('btnFirewall').addEventListener('click', async () => {
  const btn = $('btnFirewall');
  btn.disabled = true;
  const r = await api.network.firewall();
  btn.disabled = false;
  toast(r.ok ? t('access.firewallAdded') : t('access.firewallFailed'), r.ok ? 'ok' : 'error');
});

$('btnTestPort').addEventListener('click', async () => {
  const btn = $('btnTestPort');
  const hint = $('portHint');
  const port = S.server?.port || 25565;

  btn.disabled = true;
  btn.textContent = t('access.forwardTesting');
  hint.textContent = '';

  const r = await api.network.testPort();

  btn.disabled = false;
  btn.textContent = t('access.forwardTest');

  if (r.reason === 'not-listening') {
    hint.textContent = t('access.forwardNeedsRunning');
    hint.style.color = 'var(--warn)';
    return;
  }
  if (!r.ok) {
    hint.textContent = t('settings.updateFailed');
    hint.style.color = 'var(--danger)';
    return;
  }
  hint.textContent = r.open ? t('access.forwardOpen', { port }) : t('access.forwardClosed', { port });
  hint.style.color = r.open ? 'var(--accent)' : 'var(--warn)';
});

/* -------------------------------- Language -------------------------------- */

async function setLanguage(id) {
  const res = await api.i18n.set(id);
  S.lang = res.id;
  S.strings = res.strings;
  applyStrings();
  redrawDynamic();
}

$('selLanguage').addEventListener('change', (e) => setLanguage(e.target.value));

/** Views built in JavaScript need a nudge after a language change. */
function redrawDynamic() {
  renderServer();
  renderExposure();
  $('propGroups').dataset.built = '';
  $('rulesGroups').dataset.built = '';
  if (S.view === 'contenido') refreshMods();
  if (S.view === 'jugadores') renderPlayers();
  if (S.view === 'copias') refreshBackups();
  if (S.view === 'actividad') renderEventFeed(S.events);
  if (S.view === 'archivos') openFolder(S.filePath);
  if (S.view === 'mundo') refreshWorlds();
  if (document.querySelector('#tab-opciones.active')) renderProps();
}

/* -------------------------------- Updates --------------------------------- */

$('btnCheckUpdate').addEventListener('click', async () => {
  const btn = $('btnCheckUpdate');
  const hint = $('updateHint');

  btn.disabled = true;
  hint.textContent = t('settings.checking');
  hint.style.color = '';

  const r = await api.updates.check();
  btn.disabled = false;

  if (!r.ok) {
    hint.textContent = t('settings.updateFailed');
    hint.style.color = 'var(--danger)';
    return;
  }
  if (r.upToDate) {
    hint.textContent = t('settings.upToDate', { version: S.meta.version });
    hint.style.color = 'var(--accent)';
    return;
  }

  hint.innerHTML = '';
  hint.append(el('span', null, `${t('settings.updateFound', { version: r.version })} `));
  const link = el('button', 'btn btn-quiet btn-sm', t('settings.updateDownload'));
  link.addEventListener('click', () => api.shell.openExternal(r.url));
  hint.append(link);
  hint.style.color = 'var(--warn)';
});


/* ------------------------------ Activity feed ----------------------------- */

/* Which chip shows which kinds. */
const EVENT_GROUPS = {
  players: ['join', 'leave', 'death', 'op', 'deop', 'ban', 'kick', 'whitelistAdd', 'whitelistRemove'],
  progress: ['advancement', 'challenge', 'goal', 'sleep'],
  chat: ['chat', 'me'],
  server: ['ready', 'stopping', 'saved', 'overloaded', 'worldPrepared', 'error'],
};

S.eventFilter = 'all';

const eventVisible = (kind) =>
  S.eventFilter === 'all' || (EVENT_GROUPS[S.eventFilter] || []).includes(kind);

/** Renders one event as a line of plain language rather than a log entry. */
function eventLine(e) {
  const row = el('div', `ev ${e.kind}`);
  if (!eventVisible(e.kind)) row.hidden = true;

  row.append(el('span', 'ev-time', new Date(e.ts).toLocaleTimeString(S.lang, {
    hour: '2-digit', minute: '2-digit',
  })));
  row.append(el('i', 'ev-mark'));

  const body = el('div', 'ev-body');

  if (e.kind === 'chat' || e.kind === 'me') {
    body.append(el('b', null, e.player), el('span', null, ` ${e.text}`));
  } else if (e.kind === 'death') {
    // The server already writes a colourful sentence; keep it verbatim.
    body.append(el('span', null, e.text));
  } else if (['advancement', 'challenge', 'goal'].includes(e.kind)) {
    const parts = t(`events.${e.kind}`, { player: '\u0000', text: '\u0001' }).split(/[\u0000\u0001]/);
    body.append(
      el('span', null, parts[0] || ''),
      el('b', null, e.player),
      el('span', null, parts[1] || ' '),
      el('b', null, e.text),
      el('span', null, parts[2] || '')
    );
  } else {
    const key = `events.${e.kind}`;
    const text = t(key, { player: e.player || '', ms: e.ms || 0 });
    body.append(el('span', null, text === key ? e.text : text));
  }

  row.append(body);
  return row;
}

function addEvent(e) {
  const feed = $('eventFeed');
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;

  // Drop the empty state the first time something arrives.
  const empty = feed.querySelector('.empty');
  if (empty) feed.innerHTML = '';

  feed.append(eventLine(e));
  while (feed.childElementCount > 400) feed.firstElementChild.remove();
  if (atBottom) feed.scrollTop = feed.scrollHeight;
}

function renderEventFeed(list) {
  const feed = $('eventFeed');
  feed.innerHTML = '';
  if (!list.length) {
    emptyState(feed, 'pulse', t('events.empty'), t('events.emptyHint'));
    return;
  }
  for (const e of list) feed.append(eventLine(e));
  feed.scrollTop = feed.scrollHeight;
}

api.server.onEvent((e) => {
  S.events.push(e);
  if (S.events.length > 400) S.events.shift();
  addEvent(e);
});

$('eventFilters').addEventListener('click', (ev) => {
  const chip = ev.target.closest('.chip');
  if (!chip) return;
  S.eventFilter = chip.dataset.filter;
  $('eventFilters').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
  renderEventFeed(S.events);
});

$('btnClearEvents').addEventListener('click', () => {
  S.events = [];
  renderEventFeed([]);
});

/* ------------------------------ File browser ------------------------------ */

S.filePath = '';
S.editing = null;

function renderCrumbs() {
  const box = $('fileCrumbs');
  box.innerHTML = '';

  const parts = S.filePath ? S.filePath.split('/').filter(Boolean) : [];

  const root = el('button', `crumb ${parts.length ? '' : 'current'}`, t('files.root'));
  root.addEventListener('click', () => openFolder(''));
  box.append(root);

  parts.forEach((part, i) => {
    box.append(el('span', 'crumb-sep', '/'));
    const isLast = i === parts.length - 1;
    const crumb = el('button', `crumb ${isLast ? 'current' : ''}`, part);
    if (!isLast) {
      const target = parts.slice(0, i + 1).join('/');
      crumb.addEventListener('click', () => openFolder(target));
    }
    box.append(crumb);
  });
}

async function openFolder(rel) {
  closeEditor(true);
  const res = await api.files.list(rel);
  if (!res.ok) return toast(t('files.notEditable'), 'error');

  S.filePath = res.path;
  renderCrumbs();

  const box = $('fileList');
  box.innerHTML = '';

  if (!res.entries.length) {
    emptyState(box, 'files', t('files.empty'), t('files.emptyHint'));
    return;
  }

  for (const entry of res.entries) {
    const row = el('div', `row row-file ${entry.isFolder ? 'is-folder' : ''}`);
    row.append(icon(entry.isFolder ? 'folder' : 'file'));

    const main = el('div', 'row-main');
    main.append(el('span', 'row-title', entry.name));
    main.append(el('span', 'row-sub',
      entry.isFolder ? t('files.folder') : `${fmtSize(entry.size)} · ${fmtDate(entry.modified)}`));
    row.append(main);

    const actions = el('div', 'row-actions');
    const full = S.filePath ? `${S.filePath}/${entry.name}` : entry.name;

    if (entry.isFolder) {
      row.addEventListener('click', () => openFolder(full));
    } else if (entry.editable) {
      const edit = el('button', 'btn btn-quiet btn-sm', t('files.edit'));
      edit.addEventListener('click', (ev) => { ev.stopPropagation(); openEditor(full, entry.name); });
      actions.append(edit);
    }

    const ren = el('button', 'btn btn-quiet btn-sm', t('files.rename'));
    ren.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const name = await promptText(t('files.renameTitle'), entry.name);
      if (!name || name === entry.name) return;
      const r = await api.files.rename(full, name);
      if (r.ok) openFolder(S.filePath);
      else toast(t(r.error === 'EXISTS' ? 'files.exists' : 'files.badName'), 'error');
    });

    const del = el('button', 'btn btn-quiet btn-sm btn-icon');
    del.title = t('files.delete');
    del.append(icon('trash'));
    del.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (!await confirmAsk(t('files.deleteTitle'),
        t('files.deleteText', { name: entry.name }), t('common.delete'))) return;
      await api.files.remove(full);
      openFolder(S.filePath);
    });

    actions.append(ren, del);
    row.append(actions);
    box.append(row);
  }
}

async function openEditor(rel, name) {
  const res = await api.files.read(rel);
  if (!res.ok) {
    const key = res.error === 'TOO_BIG' ? 'files.tooBig' : 'files.notEditable';
    return toast(t(key), 'warn');
  }

  S.editing = { rel, name, original: res.content };
  $('editorName').textContent = name;
  $('editorArea').value = res.content;
  $('editorDirty').hidden = true;
  $('fileBrowser').hidden = true;
  $('fileCrumbs').hidden = true;
  $('fileEditor').hidden = false;
  $('editorArea').focus();
}

function closeEditor(silent = false) {
  if (!S.editing) return true;
  if (!silent && $('editorArea').value !== S.editing.original) {
    // Leave the guard to the explicit close button; folder navigation is safe
    // because it only happens from the browser, which is hidden while editing.
  }
  S.editing = null;
  $('fileEditor').hidden = true;
  $('fileBrowser').hidden = false;
  $('fileCrumbs').hidden = false;
  return true;
}

$('editorArea').addEventListener('input', () => {
  if (!S.editing) return;
  $('editorDirty').hidden = $('editorArea').value === S.editing.original;
});

$('btnEditorSave').addEventListener('click', async () => {
  if (!S.editing) return;
  const r = await api.files.write(S.editing.rel, $('editorArea').value);
  if (!r.ok) return toast(t('files.notEditable'), 'error');
  toast(t('files.saved'));
  S.editing.original = $('editorArea').value;
  $('editorDirty').hidden = true;
});

$('btnEditorClose').addEventListener('click', async () => {
  if (S.editing && $('editorArea').value !== S.editing.original) {
    if (!await confirmAsk(t('files.unsaved'), t('files.editing', { name: S.editing.name }),
      t('common.continue'))) return;
  }
  closeEditor(true);
});

$('btnNewFolder').addEventListener('click', async () => {
  const name = await promptText(t('files.newFolderTitle'), '');
  if (!name) return;
  const r = await api.files.newFolder(S.filePath, name);
  if (r.ok) openFolder(S.filePath);
  else toast(t(r.error === 'EXISTS' ? 'files.exists' : 'files.badName'), 'error');
});

$('btnFileUpload').addEventListener('click', async () => {
  const files = await api.files.pickAny();
  if (!files.length) return;
  const r = await api.files.upload(S.filePath, files);
  if (r.ok) { toast(t('files.uploaded', { n: r.added })); openFolder(S.filePath); }
});

$('btnFileReveal').addEventListener('click', () => api.files.reveal(S.filePath));

wireDrop($('fileDrop'), null, async (paths) => {
  const r = await api.files.upload(S.filePath, paths);
  if (r.ok) { toast(t('files.uploaded', { n: r.added })); openFolder(S.filePath); }
});

/* --------------------------------- Wizard --------------------------------- */

const wizard = {
  step: 0,
  steps: ['name', 'folder', 'platform', 'version', 'access'],
  data: {},

  open() {
    this.step = 0;
    this.data = { name: '', folder: '', platform: 'neoforge', version: null, exposure: 'tunnel' };
    $('wizard').hidden = false;
    this.render();
  },

  close() { $('wizard').hidden = true; },

  async render() {
    const total = this.steps.length;
    const kind = this.steps[this.step];

    $('wzStep').textContent = t('wizard.step', { n: this.step + 1, total });
    $('wzProgress').style.width = `${((this.step + 1) / total) * 100}%`;
    $('wzBack').style.visibility = this.step === 0 ? 'hidden' : 'visible';
    $('wzNext').textContent = this.step === total - 1 ? t('wizard.install') : t('wizard.next');

    const content = $('wzContent');
    content.innerHTML = '';

    if (kind === 'name') {
      $('wzTitle').textContent = t('wizard.nameTitle');
      $('wzText').textContent = t('wizard.nameText');
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = t('wizard.namePlaceholder');
      input.value = this.data.name;
      input.addEventListener('input', () => { this.data.name = input.value; });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.next(); });
      content.append(input);
      setTimeout(() => input.focus(), 60);
    }

    if (kind === 'folder') {
      $('wzTitle').textContent = t('wizard.folderTitle');
      $('wzText').textContent = t('wizard.folderText');
      const row = el('div', 'row-inline');
      const input = document.createElement('input');
      input.type = 'text';
      input.readOnly = true;
      input.placeholder = t('wizard.folderNone');
      input.value = this.data.folder;
      const pick = el('button', 'btn btn-quiet', t('settings.choose'));
      pick.addEventListener('click', async () => {
        const f = await api.dialog.pickFolder();
        if (f) { this.data.folder = f; input.value = f; }
      });
      row.append(input, pick);
      content.append(row);
    }

    if (kind === 'platform') {
      $('wzTitle').textContent = t('wizard.platformTitle');
      $('wzText').textContent = t('wizard.platformText');
      const list = el('div', 'wz-list');
      for (const pf of S.meta.platforms) {
        const btn = el('button', `pick ${pf.id === this.data.platform ? 'sel' : ''}`);
        const main = el('div', 'pick-main');
        main.append(el('b', null, pf.name), el('span', null, pf.blurb));
        btn.append(main, icon('check'));
        btn.addEventListener('click', () => {
          this.data.platform = pf.id;
          this.data.version = null;
          list.querySelectorAll('.pick').forEach((n) => n.classList.toggle('sel', n === btn));
        });
        list.append(btn);
      }
      content.append(list);
    }

    if (kind === 'version') {
      $('wzTitle').textContent = t('wizard.versionTitle');
      $('wzText').textContent = t('wizard.versionText');

      const sel = document.createElement('select');
      sel.innerHTML = `<option>${t('common.loading')}</option>`;
      content.append(sel);

      const toggle = el('label', 'check-row');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!S.settings.showBetaVersions;
      toggle.append(box, el('span', null, t('versions.showBeta')));

      const warn = el('small', 't-caption');
      warn.style.color = 'var(--warn)';
      warn.textContent = box.checked ? t('versions.betaHint') : '';
      content.append(toggle, warn);

      const pick = () => {
        try { this.data.version = JSON.parse(sel.value); } catch (_) { this.data.version = null; }
      };

      let all = [];
      try {
        all = await api.installer.versions(this.data.platform);
        fillVersions(sel, all);
        pick();
      } catch (_) {
        sel.innerHTML = `<option>${t('common.offline')}</option>`;
      }

      sel.addEventListener('change', pick);
      box.addEventListener('change', async () => {
        S.settings = await api.settings.set({ showBetaVersions: box.checked });
        warn.textContent = box.checked ? t('versions.betaHint') : '';
        $('cfgShowBeta').checked = box.checked;
        fillVersions(sel, all);
        pick();
      });
    }

    if (kind === 'access') {
      $('wzTitle').textContent = t('wizard.accessTitle');
      $('wzText').textContent = t('wizard.accessText');
      const list = el('div', 'wz-list');
      const modes = [
        ['tunnel', 'access.tunnel', 'access.tunnelBlurb'],
        ['portforward', 'access.forward', 'access.forwardBlurb'],
        ['lan', 'access.lan', 'access.lanBlurb'],
      ];
      for (const [id, title, blurb] of modes) {
        const btn = el('button', `pick ${id === this.data.exposure ? 'sel' : ''}`);
        const main = el('div', 'pick-main');
        main.append(el('b', null, t(title)), el('span', null, t(blurb)));
        btn.append(main, icon('check'));
        btn.addEventListener('click', () => {
          this.data.exposure = id;
          list.querySelectorAll('.pick').forEach((n) => n.classList.toggle('sel', n === btn));
        });
        list.append(btn);
      }
      content.append(list);
    }
  },

  async next() {
    const kind = this.steps[this.step];
    if (kind === 'name' && !this.data.name.trim()) return toast(t('wizard.needName'), 'warn');
    if (kind === 'folder' && !this.data.folder) return toast(t('wizard.needFolder'), 'warn');

    if (this.step < this.steps.length - 1) {
      this.step++;
      return this.render();
    }
    if (!this.data.version) return toast(t('wizard.needVersion'), 'warn');

    this.close();

    const entry = await api.servers.add({
      name: this.data.name.trim(),
      serverPath: this.data.folder,
      platform: this.data.platform,
      exposure: this.data.exposure,
    });

    taskStart(t('wizard.installing'));
    const r = await api.installer.install({
      serverId: entry.id,
      serverPath: this.data.folder,
      platformId: this.data.platform,
      minecraft: this.data.version.minecraft,
      build: this.data.version.build,
    });
    taskEnd();

    if (r.ok === false) return toast(r.error, 'error');

    await reloadActive();
    toast(t('wizard.ready'));

    if (!S.settings.onboardingDone) setTimeout(() => tour.start(), 450);
  },
};

$('btnStartWizard').addEventListener('click', () => wizard.open());
$('wzNext').addEventListener('click', () => wizard.next());
$('wzBack').addEventListener('click', () => { wizard.step--; wizard.render(); });
$('wzCancel').addEventListener('click', () => wizard.close());

/* ---------------------------------- Tour ---------------------------------- */

const tour = {
  i: 0,
  steps: [],

  /** The access step depends on how this server was set up. */
  build() {
    const mode = S.server?.exposure || 'tunnel';
    const accessStep = mode === 'portforward'
      ? { target: '[data-tour="access"]', title: 'tour.forwardTitle', text: 'tour.forwardText',
          view: 'ajustes', tab: { container: 'settingsTabs', name: 'acceso' } }
      : mode === 'lan'
      ? { target: '[data-tour="access"]', title: 'tour.lanTitle', text: 'tour.lanText',
          view: 'ajustes', tab: { container: 'settingsTabs', name: 'acceso' } }
      : { target: '[data-tour="ngrok"]', title: 'tour.tunnelTitle', text: 'tour.tunnelText',
          view: 'ajustes', tab: { container: 'settingsTabs', name: 'acceso' } };

    this.steps = [
      { target: '[data-tour="power"]', title: 'tour.powerTitle', text: 'tour.powerText', view: 'panel' },
      { target: '[data-tour="address"]', title: 'tour.addressTitle', text: 'tour.addressText', view: 'panel' },
      accessStep,
      { target: '.nav-item[data-view="copias"]', title: 'tour.backupTitle', text: 'tour.backupText', view: 'panel' },
      { target: '[data-tour="servers"]', title: 'tour.serversTitle', text: 'tour.serversText', view: 'panel' },
    ];
  },

  async start() {
    this.build();
    this.i = 0;
    $('tour').hidden = false;
    await this.show();
  },

  async show() {
    const step = this.steps[this.i];

    if (step.view && S.view !== step.view) go(step.view);
    if (step.tab) {
      $(step.tab.container).querySelector(`.tab[data-tab="${step.tab.name}"]`)?.click();
    }
    await new Promise((r) => setTimeout(r, 180));

    const node = document.querySelector(step.target);
    if (!node) return this.next();

    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await new Promise((r) => setTimeout(r, 220));

    const r = node.getBoundingClientRect();
    const pad = 6;
    const box = { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };

    for (const id of ['tourHole', 'tourRing']) {
      const n = $(id);
      n.setAttribute('x', box.x);
      n.setAttribute('y', box.y);
      n.setAttribute('width', box.w);
      n.setAttribute('height', box.h);
    }

    $('tourStep').textContent = t('wizard.step', { n: this.i + 1, total: this.steps.length });
    $('tourTitle').textContent = t(step.title);
    $('tourText').textContent = t(step.text);
    $('tourNext').textContent = this.i === this.steps.length - 1 ? t('tour.done') : t('tour.next');

    const dots = $('tourDots');
    dots.innerHTML = '';
    this.steps.forEach((_, idx) => dots.append(el('i', idx === this.i ? 'on' : '')));

    this.place(box);
  },

  /** Places the bubble on whichever side has room, never over the cutout. */
  place(box) {
    const pop = $('tourPop');
    const popW = 312;
    const popH = pop.offsetHeight || 160;
    const gap = 14;
    const margin = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const spots = [
      { x: box.x + box.w + gap, y: box.y, fits: box.x + box.w + gap + popW <= vw - margin },
      { x: box.x - popW - gap, y: box.y, fits: box.x - popW - gap >= margin },
      { x: box.x, y: box.y + box.h + gap, fits: box.y + box.h + gap + popH <= vh - margin },
      { x: box.x, y: box.y - popH - gap, fits: box.y - popH - gap >= margin },
    ];

    const spot = spots.find((sp) => sp.fits) || spots[2];
    pop.style.transform = `translate(${
      Math.min(Math.max(margin, spot.x), vw - popW - margin)}px, ${
      Math.min(Math.max(margin, spot.y), vh - popH - margin)}px)`;
  },

  next() {
    if (this.i >= this.steps.length - 1) return this.finish();
    this.i++;
    this.show();
  },

  async finish() {
    $('tour').hidden = true;
    S.settings = await api.settings.set({ onboardingDone: true });
  },
};

$('tourNext').addEventListener('click', () => tour.next());
$('tourSkip').addEventListener('click', () => tour.finish());
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('tour').hidden) tour.finish();
  else if (!$('wizard').hidden) wizard.close();
  else if (!$('pickerScrim').hidden) $('pickerScrim').hidden = true;
});

/* ---------------------------------- Init ---------------------------------- */

/** Reloads everything that depends on which server is active. */
async function reloadActive() {
  S.settings = await api.settings.get();
  S.server = await api.servers.active();
  S.info = S.server ? await api.installer.status(S.server.serverPath) : { installed: false };

  const hasServer = !!S.server;
  const installed = hasServer && S.info.installed;

  $('panelSetup').hidden = installed;
  $('panelBody').hidden = !installed;
  $('pathHint').textContent = installed
    ? t(S.info.hasWorld ? 'settings.folderWithWorld' : 'settings.folderInstalled',
        { version: S.info.minecraft || '' })
    : t('settings.folderHint');

  if (hasServer) {
    $('inpServerName').value = S.server.name;
    $('inpPath').value = S.server.serverPath || '';
    $('inpToken').value = S.server.ngrokToken || '';
    $('cfgAutoTunnel').checked = S.server.autoTunnel !== false;
    $('cfgAutoRestart').checked = S.server.autoRestartOnCrash !== false;
    $('cfgBackupOnStop').checked = S.server.backupOnStop !== false;
    $('cfgBackupsKeep').value = S.server.backupsKeep || 10;
    $('cfgRestartOn').checked = !!S.server.schedule?.restart?.enabled;
    $('cfgRestartTime').value = S.server.schedule?.restart?.time || '05:00';
    $('cfgBackupAuto').checked = !!S.server.schedule?.backup?.enabled;
    $('cfgBackupHours').value = S.server.schedule?.backup?.everyHours || 6;
    $('selPlatform').value = S.server.platform || 'neoforge';
    setRam(S.server.ramGb || 4);
    $('tokenHint').textContent = S.server.ngrokToken ? t('access.tokenSaved') : '';
    $('tokenHint').style.color = S.server.ngrokToken ? 'var(--accent)' : '';
  }

  S.state = await api.server.state();
  S.tunnel = await api.ngrok.state();

  renderServer();
  renderExposure();
  await loadProps();
}

async function init() {
  S.meta = await api.app.info();
  S.settings = await api.settings.get();

  const lang = S.settings.language || S.meta.language || 'en';
  const bundle = await api.i18n.bundle(lang);
  S.lang = bundle.id;
  S.strings = bundle.strings;
  applyStrings();

  const langSel = $('selLanguage');
  langSel.innerHTML = '';
  for (const l of bundle.languages) {
    const opt = document.createElement('option');
    opt.value = l.id;
    opt.textContent = l.name;
    langSel.append(opt);
  }
  langSel.value = S.lang;

  $('updateHint').textContent = t('settings.version', { version: S.meta.version });

  const psel = $('selPlatform');
  psel.innerHTML = '';
  for (const pf of S.meta.platforms) {
    const opt = document.createElement('option');
    opt.value = pf.id;
    opt.textContent = pf.name;
    psel.append(opt);
  }

  $('ramRange').max = String(S.meta.totalRamGb || 8);
  $('cfgShowBeta').checked = !!S.settings.showBetaVersions;

  for (const entry of await api.server.recentLog()) addLog(entry);
  S.events = await api.server.recentEvents();
  renderEventFeed(S.events);

  await reloadActive();
  loadPlatformVersions();

  if (!S.server) {
    setTimeout(() => wizard.open(), 500);
  } else if (!S.settings.onboardingDone && S.info.installed) {
    setTimeout(() => tour.start(), 700);
  }
}

init();
