import { $, S, api, el, icon } from '../core/dom.js';
import { confirmAsk, emptyState, fmtSize, toast } from '../ui/feedback.js';
import { go } from '../ui/navigation.js';
import { openFolder } from './files.js';
import { t } from '../core/i18n.js';

export async function refreshMods() {
  const box = $('modList');
  if (!S.info.installed) {
    emptyState(box, 'mods', t('mods.noServer'), t('mods.noServerHint'),
      { label: t('nav.settings'), onClick: () => go('ajustes') });
    return;
  }

  const res = await api.mods.list();
  const isPlugins = res.kind === 'plugins';
  $('contentTitle').textContent = t(isPlugins ? 'mods.titlePlugins' : 'mods.title');
  document.querySelector('[data-label="contenido"]').textContent =
    t(isPlugins ? 'nav.plugins' : 'nav.mods');
  $('dropTitle').textContent = t(isPlugins ? 'mods.dropPlugins' : 'mods.drop');
  $('contentSub').textContent = t(isPlugins ? 'mods.subtitlePlugins' : 'mods.subtitle');

  if (!res.supported) {
    emptyState(box, 'mods', t('mods.vanillaTitle'), t('mods.vanillaHint'));
    return;
  }
  if (!res.items.length) {
    emptyState(box, 'mods', t('mods.empty'), t('mods.emptyHint'));
    return;
  }

  box.innerHTML = '';
  for (const m of res.items) {
    const row = el('div', `row ${m.enabled ? '' : 'off'}`);
    const main = el('div', 'row-main');
    main.append(el('span', 'row-title', m.name.replace(/\.jar$/, '')));
    main.append(el('span', 'row-sub', fmtSize(m.size)));

    const actions = el('div', 'row-actions');
    const toggle = el('button', 'btn btn-quiet btn-sm', m.enabled ? t('mods.disable') : t('mods.enable'));
    toggle.addEventListener('click', async () => { await api.mods.toggle(m.file); refreshMods(); });

    const del = el('button', 'btn btn-quiet btn-sm btn-icon');
    del.title = t('common.delete');
    del.append(icon('trash'));
    del.addEventListener('click', async () => {
      if (!await confirmAsk(t('mods.deleteTitle'), t('mods.deleteText', { name: m.name }), t('common.delete'))) return;
      await api.mods.remove(m.file);
      refreshMods();
      toast(t('mods.deleted'));
    });

    actions.append(toggle, del);
    row.append(main, actions);
    box.append(row);
  }
}

$('btnAddJars').addEventListener('click', async () => {
  const files = await api.dialog.pickJars();
  if (!files.length) return;
  const r = await api.mods.add(files);
  if (r.ok) { toast(t('mods.added', { n: r.added })); refreshMods(); }
  else toast(r.error, 'error');
});
$('btnOpenMods').addEventListener('click', () => api.mods.openFolder());

/** `exts` may be null to accept any file, as the file browser does. */
export function wireDrop(zone, exts, onFiles) {
  ['dragenter', 'dragover'].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
  zone.addEventListener('drop', (e) => {
    const paths = [...e.dataTransfer.files]
      .map((f) => api.pathForFile(f))
      .filter((p) => p && (!exts || exts.some((x) => p.toLowerCase().endsWith(x))));
    if (!paths.length) {
      return toast(exts ? t('mods.onlyJar', { ext: exts.join(', ') }) : t('files.badName'), 'warn');
    }
    onFiles(paths);
  });
}

wireDrop($('modDrop'), ['.jar'], async (paths) => {
  const r = await api.mods.add(paths);
  if (r.ok) { toast(t('mods.added', { n: r.added })); refreshMods(); }
  else toast(r.error, 'error');
});
