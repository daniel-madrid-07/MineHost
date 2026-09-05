import { $, S, api, el, icon } from '../core/dom.js';
import { confirmAsk, emptyState, fmtSize, taskEnd, taskStart, toast } from '../ui/feedback.js';
import { refreshDatapacks } from './datapacks.js';
import { renderGamerules } from './gamerules.js';
import { t } from '../core/i18n.js';
import { wireTabs } from '../ui/navigation.js';

wireTabs('worldTabs', (tab) => {
  if (tab === 'reglas') renderGamerules();
  if (tab === 'datapacks') refreshDatapacks();
});

export async function refreshWorlds() {
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
