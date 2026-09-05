import { $, S, api } from '../core/dom.js';
import { applyStrings } from '../core/i18n.js';
import { openFolder } from './files.js';
import { refreshBackups } from './backups.js';
import { refreshMods } from './mods.js';
import { refreshWorlds } from './worlds.js';
import { renderEventFeed } from './activity.js';
import { renderExposure } from './access-modes.js';
import { renderPerf } from './performance.js';
import { renderPlayers } from './players.js';
import { renderProps } from './server-properties.js';
import { renderServer } from './server-state.js';
import { renderWakeHint } from './wake.js';

async function setLanguage(id) {
  const res = await api.i18n.set(id);
  S.lang = res.id;
  S.strings = res.strings;
  // The settings catalogue is translated in the main process, so it arrives
  // rebuilt rather than being re-resolved here.
  if (res.catalog) S.meta.catalog = res.catalog;
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
  renderPerf(S.history[S.history.length - 1]);
  if (S.wake) renderWakeHint(S.wake);
  if (S.view === 'mundo') refreshWorlds();
  if (document.querySelector('#tab-opciones.active')) renderProps();
}
