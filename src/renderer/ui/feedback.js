/**
 * Toasts, the progress strip, confirmation dialogs and the formatting
 * helpers that captions rely on.
 */

import { $, S, api, el, icon } from '../core/dom.js';
import { t } from '../core/i18n.js';

export function toast(msg, kind = 'ok') {
  const t = el('div', `toast ${kind === 'ok' ? '' : kind}`);
  t.append(el('span', null, msg));
  $('toasts').appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity 180ms, transform 180ms';
    t.style.opacity = '0';
    t.style.transform = 'translateX(10px)';
    setTimeout(() => t.remove(), 200);
  }, 4200);
}

let taskDepth = 0;
export function taskStart(title) {
  taskDepth++;
  $('taskTitle').textContent = title;
  $('taskText').textContent = '';
  $('taskBar').style.width = '0%';
  $('task').hidden = false;
}
export function taskEnd() {
  taskDepth = Math.max(0, taskDepth - 1);
  if (!taskDepth) $('task').hidden = true;
}

api.app.onProgress(({ label, percent, indeterminate }) => {
  if ($('task').hidden) return;
  if (label) $('taskText').textContent = label;
  const bar = $('taskBar');
  if (indeterminate) {
    bar.style.width = '38%';
    bar.style.opacity = '0.55';
  } else {
    bar.style.opacity = '1';
    bar.style.width = `${percent || 0}%`;
  }
});

export function confirmAsk(title, text, danger = 'Continuar') {
  return new Promise((resolve) => {
    $('cfTitle').textContent = title;
    $('cfText').textContent = text;
    $('cfYes').textContent = danger;
    $('confirm').hidden = false;

    const done = (v) => {
      $('confirm').hidden = true;
      $('cfYes').removeEventListener('click', yes);
      $('cfNo').removeEventListener('click', no);
      resolve(v);
    };
    const yes = () => done(true);
    const no = () => done(false);
    $('cfYes').addEventListener('click', yes);
    $('cfNo').addEventListener('click', no);
  });
}

export const fmtSize = (b) =>
  b > 1073741824 ? `${(b / 1073741824).toFixed(1)} GB`
  : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB`
  : `${Math.max(1, Math.round(b / 1024))} KB`;

/** 12500 reads as 12.5k: exact counts mean nothing at this scale. */
export const compactNumber = (n) => {
  const v = Number(n) || 0;
  if (v < 1000) return String(v);
  if (v < 1000000) return `${(v / 1000).toFixed(v < 10000 ? 1 : 0)}k`;
  return `${(v / 1000000).toFixed(1)}M`;
};

export const fmtDate = (ms) => new Date(ms).toLocaleString(S.lang, {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
});

export function emptyState(parent, iconName, title, sub, action) {
  parent.innerHTML = '';
  const e = el('div', 'empty');
  e.append(icon(iconName), el('b', null, title), el('span', null, sub));
  if (action) {
    const b = el('button', 'btn btn-quiet btn-sm', action.label);
    b.addEventListener('click', action.onClick);
    e.append(b);
  }
  parent.append(e);
}
