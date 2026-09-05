import { $, S, api } from '../core/dom.js';
import { errText, t } from '../core/i18n.js';
import { go } from '../ui/navigation.js';
import { taskEnd, taskStart, toast } from '../ui/feedback.js';

$('btnPower').addEventListener('click', async () => {
  if (S.state.status === 'running') {
    taskStart(t('panel.powerStop'));
    const r = await api.server.stop();
    taskEnd();
    if (!r.ok) toast(r.error, 'error');
    return;
  }

  go('consola');
  const r = await api.server.start();
  if (!r.ok) { toast(errText(r.error), 'error'); return; }

  if (S.server?.autoTunnel) {
    if (!S.server?.ngrokToken) {
      toast(t('panel.addressHintToken'), 'warn');
      return;
    }
    const tunnelResult = await api.ngrok.start();
    if (!tunnelResult.ok) toast(errText(tunnelResult.error), 'error');
  }
});

$('btnCopyPublic').addEventListener('click', async () => {
  if (!S.tunnel.address) return;
  await navigator.clipboard.writeText(S.tunnel.address);
  toast(t('common.copied'));
});
$('btnCopyLocal').addEventListener('click', async () => {
  await navigator.clipboard.writeText('localhost');
  toast(t('common.copied'));
});
$('btnOpenFolder').addEventListener('click', () => {
  if (S.server?.serverPath) api.shell.openPath(S.server?.serverPath);
});
