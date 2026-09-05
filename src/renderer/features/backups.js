import { $, S, api, el, icon } from '../core/dom.js';
import { confirmAsk, emptyState, fmtDate, fmtSize, taskEnd, taskStart, toast } from '../ui/feedback.js';
import { openFolder } from './files.js';
import { t } from '../core/i18n.js';

export async function refreshBackups() {
  if (!S.server?.serverPath) return;
  const box = $('backupList');
  const list = await api.backups.list(S.server?.serverPath);

  if (!list.length) {
    emptyState(box, 'backup', t('backups.empty'),
      'Crea una antes de instalar mods nuevos o de tocar el mundo.',
      { label: t('backups.emptyCta'), onClick: () => $('btnBackupNow').click() });
    return;
  }

  box.innerHTML = '';
  for (const b of list) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.append(el('span', 'row-title', fmtDate(b.created)));
    main.append(el('span', 'row-sub', `${fmtSize(b.size)} · ${b.file}`));

    const restore = el('button', 'btn btn-quiet btn-sm', t('backups.restore'));
    restore.addEventListener('click', async () => {
      if (!await confirmAsk(t('backups.restoreTitle'), t('backups.restoreText'), t('backups.restore'))) return;
      taskStart(t('backups.restoring'));
      const r = await api.backups.restore(b.file);
      taskEnd();
      if (r.ok) toast(t('backups.restored'));
      else toast(r.error, 'error');
      refreshBackups();
    });

    const del = el('button', 'btn btn-quiet btn-sm btn-icon');
    del.title = t('common.delete');
    del.append(icon('trash'));
    del.addEventListener('click', async () => {
      if (!await confirmAsk(t('backups.deleteTitle'), t('backups.deleteText'), t('common.delete'))) return;
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
  taskStart(t('backups.creating'));
  const r = await api.backups.create('manual');
  taskEnd();
  if (r.ok) toast(t('backups.created', { size: fmtSize(r.size) }));
  else toast(r.error, 'error');
  refreshBackups();
});
$('btnOpenBackups').addEventListener('click', () => api.backups.openFolder());
