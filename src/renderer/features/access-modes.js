import { $, S, api } from '../core/dom.js';
import { renderTunnel } from './server-state.js';
import { t } from '../core/i18n.js';
import { toast } from '../ui/feedback.js';

export function renderExposure() {
  const mode = S.server?.exposure || 'tunnel';
  document.querySelectorAll('#exposureModes .mode').forEach((b) =>
    b.classList.toggle('sel', b.dataset.mode === mode));

  $('paneTunnel').hidden = mode !== 'tunnel';
  $('paneForward').hidden = mode !== 'portforward';
  $('paneLan').hidden = mode !== 'lan';

  // Auto-tunnel only means anything when the tunnel is the chosen route.
  const autoRow = $('cfgAutoTunnel')?.closest('.switch-row');
  if (autoRow) autoRow.hidden = mode !== 'tunnel';

  if (mode === 'portforward' || mode === 'lan') refreshNetwork();
  renderTunnel();
}

async function refreshNetwork() {
  S.net = await api.network.summary();
  const port = S.server?.port || 25565;

  $('fwStep1Hint').textContent = t('access.forwardStep1Hint', { ip: S.net.localIp || '—' });
  $('fwStep2Hint').textContent = t('access.forwardStep2Hint', { port, ip: S.net.localIp || '—' });
  $('routerUrl').textContent = S.net.gateway || '192.168.1.1';
  $('fwPublicAddr').textContent = S.net.publicIp ? `${S.net.publicIp}:${port}` : '—';
  $('lanAddr').textContent = S.net.localIp ? `${S.net.localIp}:${port}` : '—';
  $('cgnatNotice').hidden = !S.net.cgnat;
  $('inpPort').value = port;

  renderTunnel();
}

$('exposureModes').addEventListener('click', async (e) => {
  const btn = e.target.closest('.mode');
  if (!btn || !S.server) return;
  S.server = await api.servers.update(S.server.id, { exposure: btn.dataset.mode });
  renderExposure();
});

$('btnOpenRouter').addEventListener('click', () => {
  if (S.net.gateway) api.shell.openExternal(`http://${S.net.gateway}`);
});

$('btnNetRefresh').addEventListener('click', refreshNetwork);

$('btnCopyForward').addEventListener('click', async () => {
  const v = $('fwPublicAddr').textContent;
  if (v && v !== '—') { await navigator.clipboard.writeText(v); toast(t('common.copied')); }
});

$('btnCopyLan').addEventListener('click', async () => {
  const v = $('lanAddr').textContent;
  if (v && v !== '—') { await navigator.clipboard.writeText(v); toast(t('common.copied')); }
});

$('inpPort').addEventListener('change', async (e) => {
  const port = Math.max(1024, Math.min(65535, +e.target.value || 25565));
  e.target.value = port;
  S.server = await api.servers.update(S.server.id, { port });
  refreshNetwork();
});

$('btnFirewall').addEventListener('click', async () => {
  const btn = $('btnFirewall');
  btn.disabled = true;
  const r = await api.network.firewall();
  btn.disabled = false;
  toast(r.ok ? t('access.firewallAdded') : t('access.firewallFailed'), r.ok ? 'ok' : 'error');
});

$('btnTestPort').addEventListener('click', async () => {
  const btn = $('btnTestPort');
  const hint = $('portHint');
  const port = S.server?.port || 25565;

  btn.disabled = true;
  btn.textContent = t('access.forwardTesting');
  hint.textContent = '';

  const r = await api.network.testPort();

  btn.disabled = false;
  btn.textContent = t('access.forwardTest');

  if (r.reason === 'not-listening') {
    hint.textContent = t('access.forwardNeedsRunning');
    hint.style.color = 'var(--warn)';
    return;
  }
  if (!r.ok) {
    hint.textContent = t('settings.updateFailed');
    hint.style.color = 'var(--danger)';
    return;
  }
  hint.textContent = r.open ? t('access.forwardOpen', { port }) : t('access.forwardClosed', { port });
  hint.style.color = r.open ? 'var(--accent)' : 'var(--warn)';
});
