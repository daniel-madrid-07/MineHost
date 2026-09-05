import { $, S, api, el, icon } from '../core/dom.js';
import { confirmAsk, emptyState, fmtDate, fmtSize, toast } from '../ui/feedback.js';
import { promptText } from './server-picker.js';
import { t } from '../core/i18n.js';
import { wireDrop } from './mods.js';

S.filePath = '';
S.editing = null;

function renderCrumbs() {
  const box = $('fileCrumbs');
  box.innerHTML = '';

  const parts = S.filePath ? S.filePath.split('/').filter(Boolean) : [];

  const root = el('button', `crumb ${parts.length ? '' : 'current'}`, t('files.root'));
  root.addEventListener('click', () => openFolder(''));
  box.append(root);

  parts.forEach((part, i) => {
    box.append(el('span', 'crumb-sep', '/'));
    const isLast = i === parts.length - 1;
    const crumb = el('button', `crumb ${isLast ? 'current' : ''}`, part);
    if (!isLast) {
      const target = parts.slice(0, i + 1).join('/');
      crumb.addEventListener('click', () => openFolder(target));
    }
    box.append(crumb);
  });
}

export async function openFolder(rel) {
  closeEditor(true);
  const res = await api.files.list(rel);
  if (!res.ok) return toast(t('files.notEditable'), 'error');

  S.filePath = res.path;
  renderCrumbs();

  const box = $('fileList');
  box.innerHTML = '';

  if (!res.entries.length) {
    emptyState(box, 'files', t('files.empty'), t('files.emptyHint'));
    return;
  }

  for (const entry of res.entries) {
    const row = el('div', `row row-file ${entry.isFolder ? 'is-folder' : ''}`);
    row.append(icon(entry.isFolder ? 'folder' : 'file'));

    const main = el('div', 'row-main');
    main.append(el('span', 'row-title', entry.name));
    main.append(el('span', 'row-sub',
      entry.isFolder ? t('files.folder') : `${fmtSize(entry.size)} · ${fmtDate(entry.modified)}`));
    row.append(main);

    const actions = el('div', 'row-actions');
    const full = S.filePath ? `${S.filePath}/${entry.name}` : entry.name;

    if (entry.isFolder) {
      row.addEventListener('click', () => openFolder(full));
    } else if (entry.editable) {
      const edit = el('button', 'btn btn-quiet btn-sm', t('files.edit'));
      edit.addEventListener('click', (ev) => { ev.stopPropagation(); openEditor(full, entry.name); });
      actions.append(edit);
    }

    const ren = el('button', 'btn btn-quiet btn-sm', t('files.rename'));
    ren.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const name = await promptText(t('files.renameTitle'), entry.name);
      if (!name || name === entry.name) return;
      const r = await api.files.rename(full, name);
      if (r.ok) openFolder(S.filePath);
      else toast(t(r.error === 'EXISTS' ? 'files.exists' : 'files.badName'), 'error');
    });

    const del = el('button', 'btn btn-quiet btn-sm btn-icon');
    del.title = t('files.delete');
    del.append(icon('trash'));
    del.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (!await confirmAsk(t('files.deleteTitle'),
        t('files.deleteText', { name: entry.name }), t('common.delete'))) return;
      await api.files.remove(full);
      openFolder(S.filePath);
    });

    actions.append(ren, del);
    row.append(actions);
    box.append(row);
  }
}

async function openEditor(rel, name) {
  const res = await api.files.read(rel);
  if (!res.ok) {
    const key = res.error === 'TOO_BIG' ? 'files.tooBig' : 'files.notEditable';
    return toast(t(key), 'warn');
  }

  S.editing = { rel, name, original: res.content };
  $('editorName').textContent = name;
  $('editorArea').value = res.content;
  $('editorDirty').hidden = true;
  $('fileBrowser').hidden = true;
  $('fileCrumbs').hidden = true;
  $('fileEditor').hidden = false;
  $('editorArea').focus();
}

function closeEditor(silent = false) {
  if (!S.editing) return true;
  if (!silent && $('editorArea').value !== S.editing.original) {
    // Leave the guard to the explicit close button; folder navigation is safe
    // because it only happens from the browser, which is hidden while editing.
  }
  S.editing = null;
  $('fileEditor').hidden = true;
  $('fileBrowser').hidden = false;
  $('fileCrumbs').hidden = false;
  return true;
}

$('editorArea').addEventListener('input', () => {
  if (!S.editing) return;
  $('editorDirty').hidden = $('editorArea').value === S.editing.original;
});

$('btnEditorSave').addEventListener('click', async () => {
  if (!S.editing) return;
  const r = await api.files.write(S.editing.rel, $('editorArea').value);
  if (!r.ok) return toast(t('files.notEditable'), 'error');
  toast(t('files.saved'));
  S.editing.original = $('editorArea').value;
  $('editorDirty').hidden = true;
});

$('btnEditorClose').addEventListener('click', async () => {
  if (S.editing && $('editorArea').value !== S.editing.original) {
    if (!await confirmAsk(t('files.unsaved'), t('files.editing', { name: S.editing.name }),
      t('common.continue'))) return;
  }
  closeEditor(true);
});

$('btnNewFolder').addEventListener('click', async () => {
  const name = await promptText(t('files.newFolderTitle'), '');
  if (!name) return;
  const r = await api.files.newFolder(S.filePath, name);
  if (r.ok) openFolder(S.filePath);
  else toast(t(r.error === 'EXISTS' ? 'files.exists' : 'files.badName'), 'error');
});

$('btnFileUpload').addEventListener('click', async () => {
  const files = await api.files.pickAny();
  if (!files.length) return;
  const r = await api.files.upload(S.filePath, files);
  if (r.ok) { toast(t('files.uploaded', { n: r.added })); openFolder(S.filePath); }
});

$('btnFileReveal').addEventListener('click', () => api.files.reveal(S.filePath));

wireDrop($('fileDrop'), null, async (paths) => {
  const r = await api.files.upload(S.filePath, paths);
  if (r.ok) { toast(t('files.uploaded', { n: r.added })); openFolder(S.filePath); }
});
