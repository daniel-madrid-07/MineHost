/**
 * Renderer entry point: pulls the feature modules together and performs
 * the first load.
 */

import { $, S, api, loadIcons } from './core/dom.js';
import { addLog } from './features/console.js';
import { applyStrings, t } from './core/i18n.js';
import { loadPlatformVersions, setRam } from './features/settings.js';
import { loadProps } from './features/server-properties.js';
import { renderEventFeed } from './features/activity.js';
import { renderExposure } from './features/access-modes.js';
import { renderServer } from './features/server-state.js';
import { renderWakeHint } from './features/wake.js';
import { tour } from './onboarding/tour.js';
import { wizard } from './onboarding/wizard.js';

// These modules export nothing: they attach their own listeners when loaded.
// Importing them for their side effects is what puts those screens in play.
import './features/console-shortcuts.js';
import './features/language.js';
import './features/modrinth.js';
import './features/power.js';
import './features/tray.js';
import './features/tunnel-token.js';
import './features/updates.js';

/** Reloads everything that depends on which server is active. */
export async function reloadActive() {
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
  // Needed so the dashboard can show who is already an operator.
  if (S.server?.serverPath) S.players = await api.players.read(S.server.serverPath);

  renderServer();
  renderExposure();
  await loadProps();
}

async function init() {
  await loadIcons();

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
  $('cfgTray').checked = !!S.settings.minimiseToTray;

  const autoLaunch = await api.tray.autoLaunchState();
  $('cfgAutoLaunch').checked = !!autoLaunch.enabled;

  const wakeState = await api.wake.state();
  $('cfgWake').checked = wakeState.enabled;
  $('cfgWakeIdle').value = wakeState.idleMinutes;
  S.wake = { enabled: wakeState.enabled, listening: wakeState.listening };
  renderWakeHint(S.wake);

  S.history = await api.server.history();

  for (const entry of await api.server.recentLog()) addLog(entry);
  S.events = await api.server.recentEvents();
  renderEventFeed(S.events);

  await reloadActive();
  loadPlatformVersions();

  // The server can be adopted moments after start-up, or stop on its own.
  // Re-reading the state keeps the button honest if an event is ever missed.
  setInterval(async () => {
    const fresh = await api.server.state();
    if (fresh.status !== S.state.status || fresh.external !== S.state.external) {
      S.state = fresh;
      renderServer();
    }
  }, 4000);

  if (!S.server) {
    setTimeout(() => wizard.open(), 500);
  } else if (!S.settings.onboardingDone && S.info.installed) {
    setTimeout(() => tour.start(), 700);
  }
}

init();
