import { $, api, el, icon } from '../core/dom.js';
import { confirmAsk, emptyState, fmtSize, toast } from '../ui/feedback.js';
import { t } from '../core/i18n.js';
import { wireDrop } from './mods.js';

export async function refreshDatapacks() {
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
