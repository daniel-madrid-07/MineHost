const api = window.minehost;
const $ = (id) => document.getElementById(id);

const state = {
  settings: {},
  server: { status: 'stopped', players: [] },
  tunnel: { status: 'stopped', address: null },
  installed: { installed: false, version: null },
  uptimeTimer: null,
};

/* -------------------------------- Helpers -------------------------------- */

function toast(message, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind === 'ok' ? '' : kind}`;
  el.textContent = message;
  $('toasts').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .25s';
    setTimeout(() => el.remove(), 250);
  }, 4200);
}

function showOverlay(title) {
  $('overlayTitle').textContent = title;
  $('overlayText').textContent = '—';
  $('overlayBar').style.width = '0%';
  $('overlay').hidden = false;
}
function hideOverlay() { $('overlay').hidden = true; }

function humanSize(bytes) {
  if (bytes > 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function requireServerPath() {
  if (!state.settings.serverPath) {
    toast('Primero elige una carpeta para el servidor en Ajustes.', 'warn');
    switchView('ajustes');
    return null;
  }
  return state.settings.serverPath;
}

/* ------------------------------- Navigation ------------------------------ */

function switchView(name) {
  document.querySelectorAll('.nav-item').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === name)
  );
  document.querySelectorAll('.view').forEach((v) =>
    v.classList.toggle('active', v.id === `view-${name}`)
  );
  if (name === 'mods') refreshMods();
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

/* --------------------------------- Console ------------------------------- */

const consoleEl = $('console');

function appendLog({ line, level }) {
  const atBottom = consoleEl.scrollHeight - consoleEl.scrollTop - consoleEl.clientHeight < 60;
  const div = document.createElement('div');
  div.className = `l ${level || 'info'}`;
  div.textContent = line;
  consoleEl.appendChild(div);
  while (consoleEl.childElementCount > 2000) consoleEl.firstElementChild.remove();
  if (atBottom) consoleEl.scrollTop = consoleEl.scrollHeight;
}

api.server.onLog(appendLog);
api.ngrok.onLog(({ line, level }) => appendLog({ line: `[ngrok] ${line}`, level }));

$('btnClearLog').addEventListener('click', () => { consoleEl.innerHTML = ''; });

$('cmdForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('cmdInput');
  const cmd = input.value.trim();
  if (!cmd) return;
  const res = await api.server.command(cmd);
  if (!res.ok) toast(res.error, 'error');
  input.value = '';
});

/* ------------------------------ Server state ----------------------------- */

const LABELS = {
  stopped: 'Apagado',
  starting: 'Arrancando…',
  running: 'En marcha',
  stopping: 'Apagando…',
};

function renderServerState() {
  const { status, players, startedAt } = state.server;

  $('statServer').textContent = LABELS[status] || status;
  $('statPlayers').textContent = players.length;
  $('statVersion').textContent = state.installed.version
    ? `NeoForge ${state.installed.version}`
    : '—';

  const chip = $('chipServer');
  chip.className = `status-chip ${status === 'running' ? 'on' : status === 'stopped' ? '' : 'warn'}`;
  chip.querySelector('span').textContent =
    status === 'running' ? 'Servidor activo' :
    status === 'stopped' ? 'Servidor apagado' : LABELS[status];

  const btn = $('btnPower');
  btn.disabled = status === 'starting' || status === 'stopping';
  btn.textContent =
    status === 'stopped' ? 'Encender servidor' :
    status === 'running' ? 'Apagar servidor' : LABELS[status];
  btn.className = `btn ${status === 'stopped' ? 'btn-primary' : 'btn-soft'}`;

  const list = $('playerList');
  if (!players.length) {
    list.className = 'player-list empty';
    list.textContent = 'Nadie conectado ahora mismo.';
  } else {
    list.className = 'player-list';
    list.innerHTML = '';
    for (const p of players) {
      const tag = document.createElement('div');
      tag.className = 'player-tag';
      tag.textContent = p;
      list.appendChild(tag);
    }
  }

  clearInterval(state.uptimeTimer);
  if (status === 'running' && startedAt) {
    const tick = () => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      const h = String(Math.floor(s / 3600)).padStart(2, '0');
      const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      const sec = String(s % 60).padStart(2, '0');
      $('statUptime').textContent = `${h}:${m}:${sec}`;
    };
    tick();
    state.uptimeTimer = setInterval(tick, 1000);
  } else {
    $('statUptime').textContent = '—';
  }
}

function renderTunnelState() {
  const { status, address } = state.tunnel;

  const chip = $('chipTunnel');
  chip.className = `status-chip ${status === 'running' ? 'on' : status === 'stopped' ? '' : 'warn'}`;
  chip.querySelector('span').textContent =
    status === 'running' ? 'Túnel activo' :
    status === 'starting' ? 'Abriendo túnel…' : 'Túnel apagado';

  $('tunnelBadge').textContent = status === 'running' ? 'En directo' : 'Sin túnel';
  $('tunnelBadge').className = `badge ${status === 'running' ? 'live' : ''}`;

  $('addressValue').textContent = address || '—';
  $('btnCopy').disabled = !address;
  $('addressHint').textContent = address
    ? 'Comparte esta dirección. Cambia cada vez que reinicias el túnel (plan gratuito de ngrok).'
    : 'Enciende el servidor para generar una dirección pública.';
}

api.server.onState((s) => { state.server = s; renderServerState(); });
api.ngrok.onState((s) => { state.tunnel = s; renderTunnelState(); });

api.installer.onProgress(({ label, percent, indeterminate }) => {
  $('overlayText').textContent = label || '';
  const bar = $('overlayBar');
  bar.classList.toggle('indeterminate', !!indeterminate);
  if (!indeterminate) bar.style.width = `${percent || 0}%`;
});

/* ------------------------------ Power button ----------------------------- */

$('btnPower').addEventListener('click', async () => {
  if (state.server.status === 'running') {
    await api.ngrok.stop();
    const res = await api.server.stop();
    if (!res.ok) toast(res.error, 'error');
    return;
  }

  const serverPath = requireServerPath();
  if (!serverPath) return;

  if (!state.installed.installed) {
    toast('Aún no has instalado el servidor. Ve a Ajustes e instálalo.', 'warn');
    switchView('ajustes');
    return;
  }

  const java = await api.java.detect();
  if (!java.found) {
    toast('No se ha encontrado Java 21. Instala el servidor de nuevo para descargarlo.', 'error');
    return;
  }

  switchView('consola');

  const res = await api.server.start({
    serverPath,
    javaPath: state.settings.javaPath || java.best.path,
    ramGb: state.settings.ramGb,
    neoforgeVersion: state.installed.version,
  });

  if (!res.ok) { toast(res.error, 'error'); return; }

  if (state.settings.autoTunnel) {
    if (!state.settings.ngrokToken) {
      toast('Servidor encendido. Añade tu authtoken de ngrok para que entren desde fuera.', 'warn');
      return;
    }
    const t = await api.ngrok.start(25565);
    if (!t.ok) toast(`Túnel: ${t.error}`, 'error');
    else toast('Túnel abierto. Ya puedes compartir la dirección.');
  }
});

/* --------------------------------- Copy ---------------------------------- */

$('btnCopy').addEventListener('click', async () => {
  if (!state.tunnel.address) return;
  await navigator.clipboard.writeText(state.tunnel.address);
  toast('Dirección copiada al portapapeles.');
});

$('btnCopyLocal').addEventListener('click', async () => {
  await navigator.clipboard.writeText('localhost');
  toast('Copiado: localhost');
});

$('btnOpenFolder').addEventListener('click', () => {
  const p = requireServerPath();
  if (p) api.shell.openPath(p);
});

/* ---------------------------------- Mods --------------------------------- */

async function refreshMods() {
  const list = $('modList');
  if (!state.settings.serverPath) {
    list.innerHTML = '<div class="empty-state">Elige primero una carpeta de servidor en Ajustes.</div>';
    return;
  }

  const mods = await api.mods.list(state.settings.serverPath);
  if (!mods.length) {
    list.innerHTML = '<div class="empty-state">Todavía no hay mods. Arrastra archivos .jar aquí arriba.</div>';
    return;
  }

  list.innerHTML = '';
  for (const mod of mods) {
    const row = document.createElement('div');
    row.className = `mod-row ${mod.enabled ? '' : 'off'}`;

    const name = document.createElement('div');
    name.className = 'mod-name';
    name.textContent = mod.name;

    const size = document.createElement('div');
    size.className = 'mod-size';
    size.textContent = humanSize(mod.size);

    const actions = document.createElement('div');
    actions.className = 'mod-actions';

    const toggle = document.createElement('button');
    toggle.className = 'btn btn-soft';
    toggle.textContent = mod.enabled ? 'Desactivar' : 'Activar';
    toggle.addEventListener('click', async () => {
      await api.mods.toggle(state.settings.serverPath, mod.file);
      refreshMods();
    });

    const del = document.createElement('button');
    del.className = 'btn btn-ghost';
    del.textContent = 'Borrar';
    del.addEventListener('click', async () => {
      await api.mods.remove(state.settings.serverPath, mod.file);
      refreshMods();
      toast(`Mod eliminado: ${mod.name}`);
    });

    actions.append(toggle, del);
    row.append(name, size, actions);
    list.appendChild(row);
  }
}

$('btnAddMods').addEventListener('click', async () => {
  const p = requireServerPath();
  if (!p) return;
  const files = await api.dialog.pickMods();
  if (!files.length) return;
  const n = await api.mods.add(p, files);
  toast(`${n} mod(s) añadidos.`);
  refreshMods();
});

$('btnOpenMods').addEventListener('click', () => {
  const p = requireServerPath();
  if (p) api.shell.openPath(`${p}\\mods`);
});

const dz = $('dropzone');
['dragenter', 'dragover'].forEach((ev) =>
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); })
);
['dragleave', 'drop'].forEach((ev) =>
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); })
);
dz.addEventListener('drop', async (e) => {
  const p = requireServerPath();
  if (!p) return;
  const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
  const jars = paths.filter((f) => f.toLowerCase().endsWith('.jar'));
  if (!jars.length) return toast('Solo se aceptan archivos .jar', 'warn');
  const n = await api.mods.add(p, jars);
  toast(`${n} mod(s) añadidos.`);
  refreshMods();
});

/* -------------------------------- Settings ------------------------------- */

$('btnPickFolder').addEventListener('click', async () => {
  const folder = await api.dialog.pickFolder();
  if (!folder) return;
  $('inpServerPath').value = folder;
  state.settings = await api.settings.set({ serverPath: folder });
  await refreshInstallStatus();
  refreshMods();
});

$('inpServerPath').addEventListener('change', async (e) => {
  state.settings = await api.settings.set({ serverPath: e.target.value.trim() });
  await refreshInstallStatus();
});

$('rngRam').addEventListener('input', (e) => {
  $('ramLabel').textContent = `${e.target.value} GB`;
});
$('rngRam').addEventListener('change', async (e) => {
  state.settings = await api.settings.set({ ramGb: parseInt(e.target.value, 10) });
});

async function refreshInstallStatus() {
  if (!state.settings.serverPath) {
    state.installed = { installed: false, version: null };
    $('installStatus').textContent = 'Elige una carpeta vacía y una versión.';
    renderServerState();
    return;
  }
  state.installed = await api.installer.status(state.settings.serverPath);
  $('installStatus').textContent = state.installed.installed
    ? `Instalado: NeoForge ${state.installed.version}${state.installed.hasWorld ? ' · mundo existente' : ''}`
    : 'Esta carpeta aún no tiene un servidor instalado.';
  renderServerState();
}

$('btnInstall').addEventListener('click', async () => {
  const serverPath = $('inpServerPath').value.trim();
  if (!serverPath) return toast('Elige primero una carpeta.', 'warn');

  const version = $('selVersion').value;
  if (!version) return toast('Elige una versión.', 'warn');

  state.settings = await api.settings.set({ serverPath, neoforgeVersion: version });

  showOverlay('Instalando servidor');
  try {
    const res = await api.installer.install({ serverPath, neoforgeVersion: version });
    if (res.javaPath) state.settings = await api.settings.set({ javaPath: res.javaPath });
    toast('Servidor instalado correctamente.');
    await refreshInstallStatus();
    await loadProps();
  } catch (err) {
    toast(String(err.message || err), 'error');
  } finally {
    hideOverlay();
  }
});

/* --------------------------------- ngrok --------------------------------- */

$('lnkNgrok').addEventListener('click', (e) => {
  e.preventDefault();
  api.shell.openExternal('https://dashboard.ngrok.com/get-started/your-authtoken');
});

$('btnToggleToken').addEventListener('click', () => {
  const inp = $('inpToken');
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  $('btnToggleToken').textContent = show ? 'Ocultar' : 'Ver';
});

$('btnSaveToken').addEventListener('click', async () => {
  const token = $('inpToken').value.trim();
  if (!token) return toast('Pega tu authtoken primero.', 'warn');

  showOverlay('Preparando ngrok');
  try {
    await api.ngrok.ensure();
    const res = await api.ngrok.setToken(token);
    if (!res.ok) throw new Error(res.error);
    state.settings = await api.settings.set({ ngrokToken: token });
    $('tokenStatus').textContent = 'Authtoken guardado y verificado.';
    toast('Authtoken guardado.');
  } catch (err) {
    $('tokenStatus').textContent = '';
    toast(String(err.message || err), 'error');
  } finally {
    hideOverlay();
  }
});

$('chkAutoTunnel').addEventListener('change', async (e) => {
  state.settings = await api.settings.set({ autoTunnel: e.target.checked });
});

/* ----------------------------- server.properties -------------------------- */

const PROP_FIELDS = {
  propGamemode: 'gamemode',
  propDifficulty: 'difficulty',
  propMaxPlayers: 'max-players',
  propViewDistance: 'view-distance',
  propMotd: 'motd',
  propSeed: 'level-seed',
};
const PROP_CHECKS = {
  propPvp: 'pvp',
  propWhitelist: 'white-list',
  propOnlineMode: 'online-mode',
};

async function loadProps() {
  if (!state.settings.serverPath) return;
  const props = await api.props.read(state.settings.serverPath);
  if (!Object.keys(props).length) return;

  for (const [id, key] of Object.entries(PROP_FIELDS)) {
    if (props[key] !== undefined) $(id).value = props[key];
  }
  for (const [id, key] of Object.entries(PROP_CHECKS)) {
    if (props[key] !== undefined) $(id).checked = props[key] === 'true';
  }
}

$('btnSaveProps').addEventListener('click', async () => {
  const p = requireServerPath();
  if (!p) return;

  const values = {};
  for (const [id, key] of Object.entries(PROP_FIELDS)) values[key] = $(id).value;
  for (const [id, key] of Object.entries(PROP_CHECKS)) values[key] = $(id).checked ? 'true' : 'false';

  await api.props.write(p, values);
  $('propsStatus').textContent = state.server.status === 'running'
    ? 'Guardado. Reinicia el servidor para aplicar los cambios.'
    : 'Guardado.';
  toast('Opciones guardadas.');
});

/* ---------------------------------- Init --------------------------------- */

async function loadVersions() {
  const sel = $('selVersion');
  try {
    const versions = await api.installer.versions();
    sel.innerHTML = '';
    for (const v of versions.slice(0, 30)) {
      const opt = document.createElement('option');
      opt.value = v.latest;
      opt.textContent = `Minecraft ${v.minecraft}  ·  NeoForge ${v.latest}`;
      sel.appendChild(opt);
    }
    if (state.settings.neoforgeVersion) {
      const match = [...sel.options].find((o) => o.value === state.settings.neoforgeVersion);
      if (match) sel.value = state.settings.neoforgeVersion;
    }
  } catch (err) {
    sel.innerHTML = '<option value="">Sin conexión</option>';
    toast('No se pudo cargar la lista de versiones. Revisa tu conexión.', 'error');
  }
}

async function init() {
  state.settings = await api.settings.get();

  $('inpServerPath').value = state.settings.serverPath || '';
  $('inpToken').value = state.settings.ngrokToken || '';
  $('chkAutoTunnel').checked = state.settings.autoTunnel !== false;
  if (state.settings.ngrokToken) $('tokenStatus').textContent = 'Authtoken guardado.';

  const totalRam = await api.system.ram();
  const rng = $('rngRam');
  rng.max = String(Math.max(2, Math.min(32, totalRam - 2)));
  rng.value = String(state.settings.ramGb || 4);
  $('ramLabel').textContent = `${rng.value} GB`;
  $('ramHint').textContent = `Tu equipo tiene ${totalRam} GB. Deja al menos 2 GB libres para Windows.`;

  state.server = await api.server.state();
  state.tunnel = await api.ngrok.state();

  await refreshInstallStatus();
  await loadProps();
  renderServerState();
  renderTunnelState();
  loadVersions();
}

init();
