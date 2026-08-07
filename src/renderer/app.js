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
  info: {},
  meta: {},
  server: { status: 'stopped', players: [] },
  tunnel: { status: 'stopped', address: null },
  view: 'panel',
  uptimeTimer: null,
  props: {},
  propsDirty: {},
  playerTab: 'ops',
  players: { ops: [], whitelist: [], bans: [], ipBans: [] },
};

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

const fmtDate = (ms) => new Date(ms).toLocaleString('es-ES', {
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
api.ngrok.onLog(({ line, level }) => addLog({ line: `[túnel] ${line}`, level }));

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

const LABEL = { stopped: 'Apagado', starting: 'Arrancando', running: 'En marcha', stopping: 'Apagando' };

function renderServer() {
  const { status, players, startedAt } = S.server;
  const platform = S.meta.platforms?.find((p) => p.id === (S.info.platform || S.settings.platform));

  $('stState').textContent = LABEL[status];
  $('stPlayers').textContent = players.length;
  $('stPlatform').textContent = S.info.installed
    ? `${platform?.name || '—'} · ${S.info.minecraft || '—'}`
    : '—';

  const pipClass = status === 'running' ? 'running' : status === 'stopped' ? '' : 'starting';
  $('chipPip').className = `pip ${pipClass}`;
  $('chipTitle').textContent = S.info.installed ? (platform?.name || 'Servidor') : 'Sin servidor';
  $('chipSub').textContent = S.info.installed
    ? `${S.info.minecraft || ''} · ${LABEL[status]}`
    : 'Sin configurar';

  $('tbStatus').hidden = status === 'stopped';
  $('tbStatusText').textContent = LABEL[status];
  $('tbStatus').querySelector('.pip').className = `pip ${pipClass}`;

  const btn = $('btnPower');
  btn.disabled = status === 'starting' || status === 'stopping' || !S.info.installed;
  $('btnPowerText').textContent =
    status === 'stopped' ? 'Encender' : status === 'running' ? 'Apagar' : LABEL[status];
  btn.className = `btn ${status === 'stopped' ? 'btn-primary' : 'btn-quiet'}`;

  const list = $('onlineList');
  $('onlineCount').textContent = players.length;
  if (!players.length) {
    list.innerHTML = '';
    const hint = el('span', 't-sm ink-subtle',
      status === 'running' ? 'Nadie conectado todavía.' : 'El servidor está apagado.');
    list.append(hint);
  } else {
    list.innerHTML = '';
    for (const p of players) {
      const tag = el('div', 'player-tag');
      tag.append(el('span', 'pip'), el('span', null, p));
      const kick = el('button', 'btn btn-quiet btn-sm', 'Expulsar');
      kick.addEventListener('click', async () => {
        await api.players.kick(p, 'Expulsado por el administrador');
        toast(`${p} expulsado.`);
      });
      tag.append(kick);
      list.append(tag);
    }
  }

  clearInterval(S.uptimeTimer);
  if (status === 'running' && startedAt) {
    const tick = () => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      const p = (n) => String(n).padStart(2, '0');
      $('stUptime').textContent = `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
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

function renderTunnel() {
  const { status, address } = S.tunnel;
  $('tunnelTag').textContent =
    status === 'running' ? 'En directo' : status === 'starting' ? 'Abriendo…' : 'Sin túnel';
  $('tunnelTag').className = `tag ${status === 'running' ? 'live' : ''}`;
  $('addrPublic').textContent = address || '—';
  $('btnCopyPublic').disabled = !address;
  $('addrHint').textContent = address
    ? 'La dirección cambia cada vez que se reinicia el túnel (plan gratuito de ngrok).'
    : S.settings.ngrokToken
      ? 'Enciende el servidor para generar la dirección.'
      : 'Añade tu authtoken de ngrok en Ajustes › Acceso remoto.';
}

api.server.onState((s) => { S.server = s; renderServer(); });
api.ngrok.onState((s) => { S.tunnel = s; renderTunnel(); });

api.server.onStats(({ ramMb, ramPercent, cpuPercent }) => {
  $('ramValue').textContent = ramMb > 1024 ? `${(ramMb / 1024).toFixed(1)} GB` : `${ramMb} MB`;
  const ramPct = Math.min(100, Math.round((ramMb / 1024 / (S.settings.ramGb || 4)) * 100));
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
    toast('El puerto 25565 ya está en uso. ¿Tienes otro servidor abierto?', 'error');
  } else if (reason === 'eula') {
    toast('Falta aceptar el EULA de Minecraft.', 'error');
  } else {
    toast('El servidor se cerró de forma inesperada. Mira la consola.', 'error');
  }
});

/* -------------------------------- Power ---------------------------------- */

$('btnPower').addEventListener('click', async () => {
  if (S.server.status === 'running') {
    taskStart('Apagando el servidor');
    const r = await api.server.stop();
    taskEnd();
    if (!r.ok) toast(r.error, 'error');
    return;
  }

  go('consola');
  const r = await api.server.start();
  if (!r.ok) { toast(r.error, 'error'); return; }

  if (S.settings.autoTunnel) {
    if (!S.settings.ngrokToken) {
      toast('Servidor encendido. Añade tu authtoken para que entren desde fuera.', 'warn');
      return;
    }
    const t = await api.ngrok.start(25565);
    if (!t.ok) toast(`Túnel: ${t.error}`, 'error');
  }
});

$('btnCopyPublic').addEventListener('click', async () => {
  if (!S.tunnel.address) return;
  await navigator.clipboard.writeText(S.tunnel.address);
  toast('Dirección copiada.');
});
$('btnCopyLocal').addEventListener('click', async () => {
  await navigator.clipboard.writeText('localhost');
  toast('Copiado: localhost');
});
$('btnOpenFolder').addEventListener('click', () => {
  if (S.settings.serverPath) api.shell.openPath(S.settings.serverPath);
});

/* --------------------------------- Mods ---------------------------------- */

async function refreshMods() {
  const box = $('modList');
  if (!S.info.installed) {
    emptyState(box, 'mods', 'Aún no hay servidor',
      'Instala un servidor para poder añadir mods.',
      { label: 'Ir a Ajustes', onClick: () => go('ajustes') });
    return;
  }

  const res = await api.mods.list();
  const isPlugins = res.kind === 'plugins';
  $('contentTitle').textContent = isPlugins ? 'Plugins' : 'Mods';
  document.querySelector('[data-label="contenido"]').textContent = isPlugins ? 'Plugins' : 'Mods';
  $('dropTitle').textContent = isPlugins ? 'Suelta aquí tus plugins' : 'Suelta aquí tus mods';
  $('contentSub').textContent = isPlugins
    ? 'Tus amigos no necesitan instalar nada.'
    : 'Tus amigos necesitan los mismos mods para entrar.';

  if (!res.supported) {
    emptyState(box, 'mods', 'Vanilla no admite mods',
      'Cambia a NeoForge, Fabric o Paper desde Ajustes para poder añadirlos.');
    return;
  }
  if (!res.items.length) {
    emptyState(box, 'mods', 'Todavía no hay nada instalado',
      isPlugins ? 'Arrastra archivos .jar o búscalos en Modrinth.'
                : 'Arrastra archivos .jar o búscalos en Modrinth.');
    return;
  }

  box.innerHTML = '';
  for (const m of res.items) {
    const row = el('div', `row ${m.enabled ? '' : 'off'}`);
    const main = el('div', 'row-main');
    main.append(el('span', 'row-title', m.name.replace(/\.jar$/, '')));
    main.append(el('span', 'row-sub', fmtSize(m.size)));

    const actions = el('div', 'row-actions');
    const toggle = el('button', 'btn btn-quiet btn-sm', m.enabled ? 'Desactivar' : 'Activar');
    toggle.addEventListener('click', async () => { await api.mods.toggle(m.file); refreshMods(); });

    const del = el('button', 'btn btn-quiet btn-sm btn-icon');
    del.title = 'Borrar';
    del.append(icon('trash'));
    del.addEventListener('click', async () => {
      if (!await confirmAsk('Borrar archivo',
        `Se eliminará "${m.name}" de la carpeta del servidor.`, 'Borrar')) return;
      await api.mods.remove(m.file);
      refreshMods();
      toast('Archivo eliminado.');
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
  if (r.ok) { toast(`${r.added} archivo(s) añadidos.`); refreshMods(); }
  else toast(r.error, 'error');
});
$('btnOpenMods').addEventListener('click', () => api.mods.openFolder());

function wireDrop(zone, exts, onFiles) {
  ['dragenter', 'dragover'].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
  zone.addEventListener('drop', (e) => {
    const paths = [...e.dataTransfer.files]
      .map((f) => api.pathForFile(f))
      .filter((p) => p && exts.some((x) => p.toLowerCase().endsWith(x)));
    if (!paths.length) return toast(`Solo se aceptan archivos ${exts.join(' o ')}`, 'warn');
    onFiles(paths);
  });
}

wireDrop($('modDrop'), ['.jar'], async (paths) => {
  const r = await api.mods.add(paths);
  if (r.ok) { toast(`${r.added} archivo(s) añadidos.`); refreshMods(); }
  else toast(r.error, 'error');
});

/* -------------------------------- Modrinth -------------------------------- */

let searchTimer = null;
$('mrQuery').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  searchTimer = setTimeout(() => runSearch(q), 320);
});

async function runSearch(query) {
  const box = $('mrResults');
  if (!S.info.installed) {
    emptyState(box, 'search', 'Primero instala un servidor',
      'Necesito saber la versión y la plataforma para buscar contenido compatible.');
    return;
  }

  box.innerHTML = '';
  for (let i = 0; i < 4; i++) box.append(el('div', 'skeleton'));

  const res = await api.modrinth.search(query, 0);
  if (res.error) { emptyState(box, 'warn', 'No se pudo buscar', res.error); return; }
  if (!res.hits?.length) {
    emptyState(box, 'search', 'Sin resultados',
      `Nada compatible con ${S.info.minecraft} para esta plataforma.`);
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
      const warn = el('span', 'badge-mini warn', 'Solo cliente');
      warn.title = 'Este mod no hace nada en el servidor.';
      actions.append(warn);
    }
    const add = el('button', 'btn btn-quiet btn-sm', 'Instalar');
    add.addEventListener('click', async () => {
      add.disabled = true;
      add.textContent = 'Instalando…';
      taskStart(`Instalando ${hit.title}`);
      const r = await api.modrinth.install(hit.id);
      taskEnd();
      if (r.ok) {
        add.textContent = 'Instalado';
        add.classList.add('is-on');
        const extra = r.installed.length - 1;
        toast(extra > 0
          ? `${hit.title} instalado, con ${extra} dependencia(s).`
          : `${hit.title} instalado.`);
      } else {
        add.disabled = false;
        add.textContent = 'Instalar';
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
  if (!S.settings.serverPath) return;
  S.players = await api.players.read(S.settings.serverPath);
  renderPlayers();
}

function renderPlayers() {
  const tab = S.playerTab;
  $('plHint').textContent = PLAYER_COPY[tab].hint;
  $('plInput').placeholder = PLAYER_COPY[tab].ph;

  const box = $('plList');
  const items = S.players[tab] || [];
  if (!items.length) {
    emptyState(box, 'players', 'La lista está vacía',
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
    else if (entry.level) main.append(el('span', 'row-sub', `Nivel ${entry.level}`));

    const del = el('button', 'btn btn-quiet btn-sm',
      tab === 'bans' || tab === 'ipBans' ? 'Readmitir' : 'Quitar');
    del.addEventListener('click', async () => {
      const r = await api.players.mutate(tab, 'remove', label);
      if (r.ok) { toast(`${label} eliminado de la lista.`); setTimeout(refreshPlayers, 400); }
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
    toast(`${value} añadido.`);
    setTimeout(refreshPlayers, 500);
  } else toast(r.error, 'error');
}
$('plAdd').addEventListener('click', addPlayer);
$('plInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addPlayer(); });

/* -------------------------------- Backups --------------------------------- */

async function refreshBackups() {
  if (!S.settings.serverPath) return;
  const box = $('backupList');
  const list = await api.backups.list(S.settings.serverPath);

  if (!list.length) {
    emptyState(box, 'backup', 'Todavía no hay copias',
      'Crea una antes de instalar mods nuevos o de tocar el mundo.',
      { label: 'Crear la primera copia', onClick: () => $('btnBackupNow').click() });
    return;
  }

  box.innerHTML = '';
  for (const b of list) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.append(el('span', 'row-title', fmtDate(b.created)));
    main.append(el('span', 'row-sub', `${fmtSize(b.size)} · ${b.file}`));

    const restore = el('button', 'btn btn-quiet btn-sm', 'Restaurar');
    restore.addEventListener('click', async () => {
      if (!await confirmAsk('Restaurar esta copia',
        'Tu mundo actual se guardará aparte antes de sustituirlo. El servidor debe estar apagado.',
        'Restaurar')) return;
      taskStart('Restaurando la copia');
      const r = await api.backups.restore(b.file);
      taskEnd();
      if (r.ok) toast('Copia restaurada.');
      else toast(r.error, 'error');
      refreshBackups();
    });

    const del = el('button', 'btn btn-quiet btn-sm btn-icon');
    del.title = 'Borrar';
    del.append(icon('trash'));
    del.addEventListener('click', async () => {
      if (!await confirmAsk('Borrar copia', 'Esta copia se eliminará definitivamente.', 'Borrar')) return;
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
  taskStart('Creando copia de seguridad');
  const r = await api.backups.create('manual');
  taskEnd();
  if (r.ok) toast(`Copia creada (${fmtSize(r.size)}).`);
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
  if (!S.settings.serverPath) return;
  const box = $('worldList');
  const list = await api.worlds.list();

  if (!list.length) {
    emptyState(box, 'world', 'Aún no hay ningún mundo',
      'Se creará automáticamente la primera vez que enciendas el servidor.');
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
    if (w.active) actions.append(el('span', 'badge-mini ok', 'Activo'));
    else {
      const use = el('button', 'btn btn-quiet btn-sm', 'Usar');
      use.addEventListener('click', async () => {
        const r = await api.worlds.activate(w.name);
        if (r.ok) { toast(`"${w.name}" será el mundo activo.`); refreshWorlds(); }
        else toast(r.error, 'error');
      });
      actions.append(use);
    }

    const exp = el('button', 'btn btn-quiet btn-sm btn-icon');
    exp.title = 'Exportar a .zip';
    exp.append(icon('download'));
    exp.addEventListener('click', async () => {
      const dest = await api.dialog.saveZip(`${w.name}.zip`);
      if (!dest) return;
      taskStart('Exportando el mundo');
      const r = await api.worlds.export(w.name, dest);
      taskEnd();
      toast(r.ok ? 'Mundo exportado.' : r.error, r.ok ? 'ok' : 'error');
    });
    actions.append(exp);

    if (!w.active) {
      const del = el('button', 'btn btn-quiet btn-sm btn-icon');
      del.title = 'Borrar';
      del.append(icon('trash'));
      del.addEventListener('click', async () => {
        if (!await confirmAsk('Borrar mundo',
          `"${w.name}" se moverá a una carpeta de papelera dentro del servidor, por si te arrepientes.`,
          'Borrar')) return;
        const r = await api.worlds.remove(w.name);
        if (r.ok) { toast('Mundo apartado.'); refreshWorlds(); }
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
  if (r.ok) { toast(`Mundo "${r.name}" importado.`); refreshWorlds(); }
  else toast(r.error, 'error');
});

/* ------------------------------- Gamerules -------------------------------- */

function renderGamerules() {
  const box = $('rulesGroups');
  $('rulesNotice').hidden = S.server.status === 'running';
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
    emptyState(box, 'world', 'Sin datapacks',
      'Los datapacks añaden recetas, estructuras o mecánicas sin necesidad de mods.');
    return;
  }
  box.innerHTML = '';
  for (const d of list) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.append(el('span', 'row-title', d.name));
    main.append(el('span', 'row-sub', d.isFolder ? 'Carpeta' : fmtSize(d.size)));
    const del = el('button', 'btn btn-quiet btn-sm btn-icon');
    del.append(icon('trash'));
    del.addEventListener('click', async () => {
      if (!await confirmAsk('Borrar datapack', `Se eliminará "${d.name}".`, 'Borrar')) return;
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
  if (r.ok) { toast(`${r.added} datapack(s) añadidos. Reinicia para aplicarlos.`); refreshDatapacks(); }
});

/* -------------------------------- Settings -------------------------------- */

wireTabs('settingsTabs', (tab) => { if (tab === 'opciones') renderProps(); });

$('btnPickFolder').addEventListener('click', async () => {
  const folder = await api.dialog.pickFolder();
  if (!folder) return;
  $('inpPath').value = folder;
  S.settings = await api.settings.set({ serverPath: folder });
  await refreshInstallState();
  await loadProps();
});

async function loadPlatformVersions() {
  const platformId = $('selPlatform').value;
  const sel = $('selVersion');
  sel.innerHTML = '<option>Cargando…</option>';
  sel.disabled = true;

  const platform = S.meta.platforms.find((p) => p.id === platformId);
  $('platformHint').textContent = platform?.blurb || '';

  try {
    const versions = await api.installer.versions(platformId);
    sel.innerHTML = '';
    for (const v of versions.slice(0, 40)) {
      const opt = document.createElement('option');
      opt.value = JSON.stringify({ minecraft: v.minecraft, build: v.build });
      opt.textContent = `Minecraft ${v.minecraft}`;
      sel.append(opt);
    }
    sel.disabled = false;
  } catch (err) {
    sel.innerHTML = '<option>Sin conexión</option>';
    toast('No se pudo cargar la lista de versiones.', 'error');
  }
}

$('selPlatform').addEventListener('change', loadPlatformVersions);

$('btnInstall').addEventListener('click', async () => {
  const serverPath = $('inpPath').value.trim();
  if (!serverPath) return toast('Elige primero una carpeta.', 'warn');

  let choice;
  try { choice = JSON.parse($('selVersion').value); }
  catch (_) { return toast('Elige una versión.', 'warn'); }

  if (S.info.installed && !await confirmAsk('Reinstalar el servidor',
    'Se descargarán de nuevo los archivos del servidor. Tu mundo y tus mods no se tocan.',
    'Reinstalar')) return;

  taskStart('Instalando el servidor');
  const r = await api.installer.install({
    serverPath,
    platformId: $('selPlatform').value,
    minecraft: choice.minecraft,
    build: choice.build,
  });
  taskEnd();

  if (r.ok === false) { toast(r.error, 'error'); return; }
  toast('Servidor instalado.');
  S.settings = await api.settings.get();
  await refreshInstallState();
  await loadProps();
});

/* RAM: slider and number field mirror each other; the cap is the real RAM. */
function setRam(value) {
  const total = S.meta.totalRamGb || 8;
  const v = Math.max(1, Math.min(total, Math.round(value) || 1));
  $('ramRange').value = v;
  $('ramNumber').value = v;
  const warn = v > total - 2;
  $('ramHint').textContent = warn
    ? `Tu equipo tiene ${total} GB. Dejar menos de 2 GB libres puede ralentizar Windows.`
    : `Tu equipo tiene ${total} GB. Con muchos mods, 6-8 GB va sobrado.`;
  $('ramHint').style.color = warn ? 'var(--warn)' : '';
  return v;
}

$('ramRange').addEventListener('input', (e) => setRam(+e.target.value));
$('ramRange').addEventListener('change', async (e) => {
  S.settings = await api.settings.set({ ramGb: setRam(+e.target.value) });
});
$('ramNumber').addEventListener('input', (e) => {
  const v = +e.target.value;
  if (v >= 1) $('ramRange').value = Math.min(v, S.meta.totalRamGb || 8);
});
$('ramNumber').addEventListener('change', async (e) => {
  S.settings = await api.settings.set({ ramGb: setRam(+e.target.value) });
});

/* Toggles */
const bindToggle = (id, key) => {
  $(id).addEventListener('change', async (e) => {
    S.settings = await api.settings.set({ [key]: e.target.checked });
  });
};
bindToggle('cfgAutoRestart', 'autoRestartOnCrash');
bindToggle('cfgAutoTunnel', 'autoTunnel');
bindToggle('cfgBackupOnStop', 'backupOnStop');

$('cfgBackupsKeep').addEventListener('change', async (e) => {
  S.settings = await api.settings.set({ backupsKeep: Math.max(1, +e.target.value || 10) });
});

async function saveSchedule() {
  const schedule = {
    restart: { enabled: $('cfgRestartOn').checked, time: $('cfgRestartTime').value || '05:00' },
    backup: { enabled: $('cfgBackupAuto').checked, everyHours: Math.max(1, +$('cfgBackupHours').value || 6) },
  };
  const res = await api.schedule.set(schedule);
  S.settings = await api.settings.get();
  if (res.nextRestart) {
    $('nextRestartHint').textContent = `Próximo reinicio: ${fmtDate(res.nextRestart)}`;
  } else $('nextRestartHint').textContent = '';
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
  if (!token) return toast('Pega tu authtoken primero.', 'warn');

  taskStart('Preparando el túnel');
  const ensured = await api.ngrok.ensure();
  if (ensured.ok === false) { taskEnd(); return toast(ensured.error, 'error'); }
  const r = await api.ngrok.setToken(token);
  taskEnd();

  if (!r.ok) {
    $('tokenHint').textContent = r.error;
    $('tokenHint').style.color = 'var(--danger)';
    return toast(r.error, 'error');
  }
  S.settings = await api.settings.set({ ngrokToken: token });
  $('tokenHint').textContent = 'Authtoken guardado y verificado.';
  $('tokenHint').style.color = 'var(--accent)';
  toast('Todo listo para abrir el túnel.');
  renderTunnel();
});

/* ----------------------------- server.properties -------------------------- */

async function loadProps() {
  if (!S.settings.serverPath) return;
  S.props = await api.props.read(S.settings.serverPath);
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
  if (!S.settings.serverPath) return toast('Elige primero una carpeta de servidor.', 'warn');
  if (!Object.keys(S.propsDirty).length) return toast('No hay cambios que guardar.');

  const r = await api.props.write(S.settings.serverPath, S.propsDirty);
  if (r.ok === false) return toast(r.error, 'error');

  Object.assign(S.props, S.propsDirty);
  S.propsDirty = {};
  toast(S.server.status === 'running'
    ? 'Guardado. Reinicia el servidor para aplicarlo.'
    : 'Opciones guardadas.');
});

/* --------------------------------- Wizard --------------------------------- */

const wizard = {
  step: 0,
  data: { folder: '', platform: 'neoforge', version: null },

  open() {
    this.step = 0;
    this.data = { folder: S.settings.serverPath || '', platform: 'neoforge', version: null };
    $('wizard').hidden = false;
    this.render();
  },
  close() { $('wizard').hidden = true; },

  async render() {
    const total = 3;
    $('wzStep').textContent = `Paso ${this.step + 1} de ${total}`;
    $('wzProgress').style.width = `${((this.step + 1) / total) * 100}%`;
    $('wzBack').style.visibility = this.step === 0 ? 'hidden' : 'visible';
    $('wzNext').textContent = this.step === total - 1 ? 'Instalar' : 'Continuar';

    const content = $('wzContent');
    content.innerHTML = '';

    if (this.step === 0) {
      $('wzTitle').textContent = '¿Dónde guardamos el servidor?';
      $('wzText').textContent =
        'Elige una carpeta vacía. Ahí vivirán el mundo, los mods y las copias de seguridad.';
      const row = el('div', 'row-inline');
      const input = document.createElement('input');
      input.type = 'text';
      input.readOnly = true;
      input.placeholder = 'Ninguna carpeta elegida';
      input.value = this.data.folder;
      const pick = el('button', 'btn btn-quiet', 'Elegir…');
      pick.addEventListener('click', async () => {
        const f = await api.dialog.pickFolder();
        if (f) { this.data.folder = f; input.value = f; }
      });
      row.append(input, pick);
      content.append(row);
    }

    if (this.step === 1) {
      $('wzTitle').textContent = '¿Qué tipo de servidor quieres?';
      $('wzText').textContent = 'Puedes cambiarlo más adelante desde Ajustes.';
      const list = el('div', 'wz-list');
      for (const p of S.meta.platforms) {
        const btn = el('button', `pick ${p.id === this.data.platform ? 'sel' : ''}`);
        const main = el('div', 'pick-main');
        main.append(el('b', null, p.name), el('span', null, p.blurb));
        btn.append(main, icon('check'));
        btn.addEventListener('click', () => {
          this.data.platform = p.id;
          this.data.version = null;
          list.querySelectorAll('.pick').forEach((n) => n.classList.toggle('sel', n === btn));
        });
        list.append(btn);
      }
      content.append(list);
    }

    if (this.step === 2) {
      $('wzTitle').textContent = '¿Qué versión de Minecraft?';
      $('wzText').textContent = 'Todos los que entren deben usar exactamente esta versión.';
      const sel = document.createElement('select');
      sel.innerHTML = '<option>Cargando…</option>';
      content.append(sel);

      try {
        const versions = await api.installer.versions(this.data.platform);
        sel.innerHTML = '';
        for (const v of versions.slice(0, 40)) {
          const opt = document.createElement('option');
          opt.value = JSON.stringify({ minecraft: v.minecraft, build: v.build });
          opt.textContent = `Minecraft ${v.minecraft}`;
          sel.append(opt);
        }
        this.data.version = JSON.parse(sel.value);
        sel.addEventListener('change', () => { this.data.version = JSON.parse(sel.value); });
      } catch (_) {
        sel.innerHTML = '<option>Sin conexión</option>';
      }
    }
  },

  async next() {
    if (this.step === 0 && !this.data.folder) return toast('Elige una carpeta para continuar.', 'warn');

    if (this.step < 2) { this.step++; return this.render(); }
    if (!this.data.version) return toast('Elige una versión.', 'warn');

    this.close();
    taskStart('Instalando el servidor');
    const r = await api.installer.install({
      serverPath: this.data.folder,
      platformId: this.data.platform,
      minecraft: this.data.version.minecraft,
      build: this.data.version.build,
    });
    taskEnd();

    if (r.ok === false) return toast(r.error, 'error');

    S.settings = await api.settings.get();
    await refreshInstallState();
    await loadProps();
    toast('Servidor listo.');
    if (!S.settings.onboardingDone) setTimeout(() => tour.start(), 450);
  },
};

$('btnStartWizard').addEventListener('click', () => wizard.open());
$('wzNext').addEventListener('click', () => wizard.next());
$('wzBack').addEventListener('click', () => { wizard.step--; wizard.render(); });
$('wzCancel').addEventListener('click', () => wizard.close());

/* ---------------------------------- Tour ---------------------------------- */

const tour = {
  steps: [
    {
      target: '[data-tour="power"]',
      title: 'Enciende tu servidor',
      text: 'Desde aquí arranca y se detiene. La primera vez tardará un poco en generar el mundo.',
      view: 'panel',
    },
    {
      target: '[data-tour="address"]',
      title: 'Comparte esta dirección',
      text: 'Cuando el servidor esté en marcha aparecerá aquí la dirección que darás a tus amigos. Tú entras con «localhost».',
      view: 'panel',
    },
    {
      target: '[data-tour="ngrok"]',
      title: 'Configura el acceso desde fuera',
      text: 'Para que entren desde otra casa necesitas un authtoken de ngrok. Es gratis y son dos minutos.',
      view: 'ajustes',
      tab: { container: 'settingsTabs', name: 'acceso' },
    },
    {
      target: '.nav-item[data-view="copias"]',
      title: 'Haz copias de seguridad',
      text: 'Antes de instalar mods o de tocar el mundo, guarda una copia. Se restaura en un clic.',
      view: 'panel',
    },
  ],
  i: 0,

  async start() {
    this.i = 0;
    $('tour').hidden = false;
    await this.show();
  },

  async show() {
    const step = this.steps[this.i];

    if (step.view && S.view !== step.view) go(step.view);
    if (step.tab) {
      const box = $(step.tab.container);
      const tab = box.querySelector(`.tab[data-tab="${step.tab.name}"]`);
      tab?.click();
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

    $('tourStep').textContent = `Paso ${this.i + 1} de ${this.steps.length}`;
    $('tourTitle').textContent = step.title;
    $('tourText').textContent = step.text;
    $('tourNext').textContent = this.i === this.steps.length - 1 ? 'Entendido' : 'Siguiente';

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

    const spot = spots.find((s) => s.fits) || spots[2];
    const left = Math.min(Math.max(margin, spot.x), vw - popW - margin);
    const top = Math.min(Math.max(margin, spot.y), vh - popH - margin);

    pop.style.transform = `translate(${left}px, ${top}px)`;
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
  if (e.key === 'Escape') {
    if (!$('tour').hidden) tour.finish();
    else if (!$('wizard').hidden) wizard.close();
  }
});

/* ---------------------------------- Init ---------------------------------- */

async function refreshInstallState() {
  S.info = S.settings.serverPath
    ? await api.installer.status(S.settings.serverPath)
    : { installed: false };

  const setup = !S.info.installed;
  $('panelSetup').hidden = !setup;
  $('panelBody').hidden = setup;
  $('pathHint').textContent = S.info.installed
    ? `Instalado: ${S.info.minecraft || ''}${S.info.hasWorld ? ' · con mundo' : ''}`
    : 'Aquí se guardan el mundo, los mods y las copias.';

  renderServer();
}

async function init() {
  S.meta = await api.app.info();
  S.settings = await api.settings.get();

  const psel = $('selPlatform');
  psel.innerHTML = '';
  for (const p of S.meta.platforms) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name}${p.kind === 'plugins' ? ' · plugins' : p.kind === 'mods' ? ' · mods' : ''}`;
    psel.append(opt);
  }
  psel.value = S.settings.platform || 'neoforge';

  $('inpPath').value = S.settings.serverPath || '';
  $('inpToken').value = S.settings.ngrokToken || '';
  $('cfgAutoTunnel').checked = S.settings.autoTunnel !== false;
  $('cfgAutoRestart').checked = S.settings.autoRestartOnCrash !== false;
  $('cfgBackupOnStop').checked = S.settings.backupOnStop !== false;
  $('cfgBackupsKeep').value = S.settings.backupsKeep || 10;
  $('cfgRestartOn').checked = !!S.settings.schedule?.restart?.enabled;
  $('cfgRestartTime').value = S.settings.schedule?.restart?.time || '05:00';
  $('cfgBackupAuto').checked = !!S.settings.schedule?.backup?.enabled;
  $('cfgBackupHours').value = S.settings.schedule?.backup?.everyHours || 6;
  if (S.settings.ngrokToken) {
    $('tokenHint').textContent = 'Authtoken guardado.';
    $('tokenHint').style.color = 'var(--accent)';
  }

  $('ramRange').max = String(S.meta.totalRamGb || 8);
  setRam(S.settings.ramGb || 4);

  S.server = await api.server.state();
  S.tunnel = await api.ngrok.state();
  for (const entry of await api.server.recentLog()) addLog(entry);

  await refreshInstallState();
  await loadProps();
  renderTunnel();
  loadPlatformVersions();

  if (!S.settings.serverPath) {
    setTimeout(() => wizard.open(), 500);
  } else if (!S.settings.onboardingDone && S.info.installed) {
    setTimeout(() => tour.start(), 700);
  }
}

init();
