import { $, S, api, el, icon } from '../core/dom.js';
import { confirmAsk, emptyState, toast } from '../ui/feedback.js';
import { reloadActive } from '../app.js';
import { t } from '../core/i18n.js';
import { wizard } from '../onboarding/wizard.js';

export function promptText(title, value = '') {
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
