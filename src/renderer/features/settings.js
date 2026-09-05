import { $, S, api } from '../core/dom.js';
import { confirmAsk, fmtDate, taskEnd, taskStart, toast } from '../ui/feedback.js';
import { reloadActive } from '../app.js';
import { renderProps } from './server-properties.js';
import { renderServer } from './server-state.js';
import { t } from '../core/i18n.js';
import { wireTabs } from '../ui/navigation.js';
import { wizard } from '../onboarding/wizard.js';

wireTabs('settingsTabs', (tab) => { if (tab === 'opciones') renderProps(); });

$('btnPickFolder').addEventListener('click', async () => {
  const folder = await api.dialog.pickFolder();
  if (!folder) return;
  $('inpPath').value = folder;
  S.server = await api.servers.update(S.server.id, { serverPath: folder });
  await reloadActive();
});

export async function loadPlatformVersions() {
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
export function fillVersions(sel, versions) {
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
export function setRam(value) {
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
