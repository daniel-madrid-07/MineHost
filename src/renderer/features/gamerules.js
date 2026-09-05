import { $, S, api, el } from '../core/dom.js';

export function renderGamerules() {
  const box = $('rulesGroups');
  $('rulesNotice').hidden = S.state.status === 'running';
  if (box.dataset.built) return;
  box.dataset.built = '1';
  box.innerHTML = '';

  for (const group of S.meta.catalog.gamerules) {
    const card = el('article', 'card');
    const head = el('div', 'group-title');
    head.append(el('h3', null, group.title));
    card.append(head);

    for (const item of group.items) {
      card.append(optionRow(item, (value) => api.gamerules.set(item.key, value)));
    }
    box.append(card);
  }
}

/** Builds one labelled control; `onChange` receives the new value. */
export function optionRow(item, onChange, initial) {
  const row = el('div', 'opt-row');
  const label = el('div', 'opt-label');
  label.append(el('b', null, item.label));
  if (item.help) label.append(el('span', null, item.help));

  const control = el('div', 'opt-control');
  const value = initial !== undefined ? initial : item.default;

  if (item.type === 'bool') {
    const wrap = el('label', 'switch');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = String(value) === 'true';
    input.addEventListener('change', () => onChange(String(input.checked)));
    wrap.append(input, el('i'));
    control.append(wrap);
  } else if (item.type === 'select') {
    const sel = document.createElement('select');
    for (const [v, label2] of item.options) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = label2;
      sel.append(opt);
    }
    sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value));
    control.append(sel);
  } else if (item.type === 'number') {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'num';
    if (item.min != null) input.min = item.min;
    if (item.max != null) input.max = item.max;
    input.value = value;
    input.addEventListener('change', () => onChange(input.value));
    control.append(input);
    if (item.unit) control.append(el('span', 'opt-unit', item.unit));
  } else {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value ?? '';
    if (item.placeholder) input.placeholder = item.placeholder;
    input.addEventListener('change', () => onChange(input.value));
    control.append(input);
  }

  row.append(label, control);
  return row;
}
