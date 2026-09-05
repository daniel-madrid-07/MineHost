import { $, S, api } from '../core/dom.js';
import { errText, t } from '../core/i18n.js';
import { renderTunnel } from './server-state.js';
import { taskEnd, taskStart, toast } from '../ui/feedback.js';

$('btnNgrokSignup').addEventListener('click', () =>
  api.shell.openExternal('https://dashboard.ngrok.com/signup'));
$('btnNgrokToken').addEventListener('click', () =>
  api.shell.openExternal('https://dashboard.ngrok.com/get-started/your-authtoken'));

$('btnEyeToken').addEventListener('click', () => {
  const i = $('inpToken');
  const show = i.type === 'password';
  i.type = show ? 'text' : 'password';
  $('btnEyeToken').textContent = show ? 'Ocultar' : 'Ver';
});

$('btnAllowDefender').addEventListener('click', async () => {
  const btn = $('btnAllowDefender');
  btn.disabled = true;
  const r = await api.ngrok.allowInDefender();
  btn.disabled = false;

  if (r.ok) {
    btn.hidden = true;
    $('tokenHint').textContent = t('access.defenderDone');
    $('tokenHint').style.color = 'var(--accent)';
  } else {
    toast(errText(r.error), 'error');
  }
});

$('btnSaveToken').addEventListener('click', async () => {
  const token = $('inpToken').value.trim();
  if (!token) return toast(t('access.tokenMissing'), 'warn');

  taskStart(t('access.preparing'));
  const ensured = await api.ngrok.ensure();
  if (ensured.ok === false) { taskEnd(); return toast(ensured.error, 'error'); }
  const r = await api.ngrok.setToken(token);
  taskEnd();

  if (!r.ok) {
    const message = errText(r.error);
    $('tokenHint').textContent = message;
    $('tokenHint').style.color = 'var(--danger)';
    $('btnAllowDefender').hidden = r.error !== 'NGROK_QUARANTINED';
    return toast(message, 'error');
  }
  $('btnAllowDefender').hidden = true;
  S.server = await api.servers.active();
  $('tokenHint').textContent = t('access.tokenVerified');
  $('tokenHint').style.color = 'var(--accent)';
  toast(t('access.tunnelReady'));
  renderTunnel();
});
