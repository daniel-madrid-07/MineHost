import { $, api, el } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { toast } from '../ui/feedback.js';

const consoleEl = $('console');
let logFilterText = '';

export function addLog({ line, level }) {
  const atBottom = consoleEl.scrollHeight - consoleEl.scrollTop - consoleEl.clientHeight < 70;
  const row = el('div', `ln ${level || 'info'}`, line);
  if (logFilterText && !line.toLowerCase().includes(logFilterText)) row.classList.add('hidden-row');
  consoleEl.appendChild(row);
  while (consoleEl.childElementCount > 1500) consoleEl.firstElementChild.remove();
  if (atBottom) consoleEl.scrollTop = consoleEl.scrollHeight;
}

api.server.onLog(addLog);
api.ngrok.onLog(({ line, level }) => addLog({ line: `[${t('console.tunnelPrefix')}] ${line}`, level }));

$('logFilter').addEventListener('input', (e) => {
  logFilterText = e.target.value.trim().toLowerCase();
  consoleEl.querySelectorAll('.ln').forEach((n) =>
    n.classList.toggle('hidden-row', logFilterText && !n.textContent.toLowerCase().includes(logFilterText)));
});

$('btnClearLog').addEventListener('click', () => { consoleEl.innerHTML = ''; });

$('cmdForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('cmdInput');
  const cmd = input.value.trim();
  if (!cmd) return;
  const r = await api.server.command(cmd);
  if (!r.ok) toast(r.error, 'error');
  input.value = '';
});
