/**
 * Switching views and wiring tab strips.
 */

import { $, S } from '../core/dom.js';
import { openFolder } from '../features/files.js';
import { refreshBackups } from '../features/backups.js';
import { refreshMods } from '../features/mods.js';
import { refreshPlayers } from '../features/players.js';
import { refreshWorlds } from '../features/worlds.js';
import { renderEventFeed } from '../features/activity.js';
import { t } from '../core/i18n.js';

export function go(view) {
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

export function wireTabs(containerId, onChange) {
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
