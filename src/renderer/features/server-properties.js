import { $, S, api, el } from '../core/dom.js';
import { optionRow } from './gamerules.js';
import { t } from '../core/i18n.js';
import { toast } from '../ui/feedback.js';

export async function loadProps() {
  if (!S.server?.serverPath) return;
  S.props = await api.props.read(S.server?.serverPath);
  S.propsDirty = {};
  $('propGroups').dataset.built = '';
  if (document.querySelector('#tab-opciones.active')) renderProps();
}

export function renderProps() {
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
