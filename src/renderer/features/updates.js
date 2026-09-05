import { $, S, api, el } from '../core/dom.js';
import { t } from '../core/i18n.js';

$('btnCheckUpdate').addEventListener('click', async () => {
  const btn = $('btnCheckUpdate');
  const hint = $('updateHint');

  btn.disabled = true;
  hint.textContent = t('settings.checking');
  hint.style.color = '';

  const r = await api.updates.check();
  btn.disabled = false;

  if (!r.ok) {
    hint.textContent = t('settings.updateFailed');
    hint.style.color = 'var(--danger)';
    return;
  }
  if (r.upToDate) {
    hint.textContent = t('settings.upToDate', { version: S.meta.version });
    hint.style.color = 'var(--accent)';
    return;
  }

  hint.innerHTML = '';
  hint.append(el('span', null, `${t('settings.updateFound', { version: r.version })} `));
  const link = el('button', 'btn btn-quiet btn-sm', t('settings.updateDownload'));
  link.addEventListener('click', () => api.shell.openExternal(r.url));
  hint.append(link);
  hint.style.color = 'var(--warn)';
});
