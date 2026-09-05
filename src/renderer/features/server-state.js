import { $, S, api, el } from '../core/dom.js';
import { confirmAsk, toast } from '../ui/feedback.js';
import { errText, t } from '../core/i18n.js';
import { go } from '../ui/navigation.js';
import { refreshPlayers } from './players.js';
import { renderPerf } from './performance.js';

const statusLabel = (k) => t(`status.${k}`);

export function renderServer() {
  const { status, players, startedAt } = S.state;
  const external = !!S.state.external;
  const platform = S.meta.platforms?.find((p) => p.id === (S.info.platform || S.server?.platform));

  $('stState').textContent = statusLabel(status);
  $('stPlayers').textContent = players.length;
  $('stPlatform').textContent = S.info.installed
    ? `${platform?.name || '—'} · ${S.info.minecraft || '—'}`
    : '—';

  const pipClass = status === 'running' ? 'running' : status === 'stopped' ? '' : 'starting';
  $('chipPip').className = `pip ${pipClass}`;
  $('chipTitle').textContent = S.server?.name || 'MineHost';
  $('chipSub').textContent = !S.server
    ? t('servers.empty')
    : !S.info.installed
      ? t('servers.notInstalled')
      : `${S.info.minecraft || ''} · ${external ? t('server.external') : statusLabel(status)}`;

  // An adopted server has no console we can read or write.
  if ($('externalNotice')) $('externalNotice').hidden = !external;
  $('cmdInput').disabled = external;
  $('cmdSend').disabled = external;

  $('tbStatus').hidden = status === 'stopped';
  $('tbStatusText').textContent = external ? t('server.external') : statusLabel(status);
  $('tbStatus').querySelector('.pip').className = `pip ${pipClass}`;

  const btn = $('btnPower');
  const busy = status === 'starting' || status === 'stopping';
  // A running server can always be stopped, whatever the install check says.
  btn.disabled = busy || (status === 'stopped' && !S.info.installed);
  $('btnPowerText').textContent =
    status === 'stopped' ? t('panel.powerStart')
    : status === 'running' ? t('panel.powerStop')
    : statusLabel(status);
  btn.className = `btn ${status === 'stopped' ? 'btn-primary' : 'btn-quiet'}`;

  const list = $('onlineList');
  $('onlineCount').textContent = players.length;
  list.innerHTML = '';
  if (!players.length) {
    list.append(el('span', 't-sm ink-subtle',
      status === 'running' ? t('panel.nobody') : t('panel.serverOff')));
  } else {
    for (const p of players) {
      const tag = el('div', 'player-tag');

      // The player's own skin makes the list scannable at a glance.
      const face = document.createElement('img');
      face.className = 'player-face';
      face.width = 24;
      face.height = 24;
      face.alt = '';
      face.loading = 'lazy';
      face.src = `https://mc-heads.net/avatar/${encodeURIComponent(p)}/24`;
      face.addEventListener('error', () => {
        // One retry on a second service, then fall back to the status dot.
        if (face.dataset.retried) {
          face.replaceWith(el('span', 'pip'));
          return;
        }
        face.dataset.retried = '1';
        face.src = `https://minotar.net/helm/${encodeURIComponent(p)}/24.png`;
      }, { once: false });

      tag.append(face, el('span', 'player-name', p));

      const isOp = S.players.ops?.some(
        (o) => String(o.name || '').toLowerCase() === p.toLowerCase()
      );

      const actions = el('div', 'player-actions');

      // Operator: a toggle, so one click grants and the next takes it away.
      const op = el('button', `btn btn-quiet btn-sm ${isOp ? 'is-on' : ''}`,
        t(isOp ? 'panel.deop' : 'panel.op'));
      op.title = t(isOp ? 'panel.deopHint' : 'panel.opHint');
      op.addEventListener('click', async () => {
        op.disabled = true;
        const r = await api.players.mutate('ops', isOp ? 'remove' : 'add', p);
        op.disabled = false;
        if (!r.ok) return toast(errText(r.error), 'error');
        toast(t(isOp ? 'players.removed' : 'players.added', { name: p }),
          r.needsRestart ? 'warn' : 'ok');
        await refreshPlayers();
        renderServer();
      });

      const kick = el('button', 'btn btn-quiet btn-sm', t('panel.kick'));
      kick.addEventListener('click', async () => {
        await api.players.kick(p, t('players.kickReason'));
        toast(t('players.kicked', { name: p }));
      });

      // Banning is not undone by accident, so it asks first.
      const ban = el('button', 'btn btn-quiet btn-sm btn-danger-quiet', t('panel.ban'));
      ban.addEventListener('click', async () => {
        if (!await confirmAsk(t('panel.banTitle'),
          t('panel.banText', { name: p }), t('panel.ban'))) return;
        const r = await api.players.mutate('bans', 'add', p);
        if (!r.ok) return toast(errText(r.error), 'error');
        toast(t('players.banned', { name: p }), r.needsRestart ? 'warn' : 'ok');
        await refreshPlayers();
      });

      actions.append(op, kick, ban);
      tag.append(actions);
      list.append(tag);
    }
  }

  clearInterval(S.uptimeTimer);
  if (status === 'running' && startedAt) {
    const tick = () => {
      const sec = Math.floor((Date.now() - startedAt) / 1000);
      const pad = (n) => String(n).padStart(2, '0');
      $('stUptime').textContent =
        `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;
    };
    tick();
    S.uptimeTimer = setInterval(tick, 1000);
  } else {
    $('stUptime').textContent = '—';
  }

  if ($('perfCard')) $('perfCard').hidden = status !== 'running';
  $('meterRam').hidden = status !== 'running';
  $('meterCpu').hidden = status !== 'running';
  if (status !== 'running') {
    $('ramBar').style.width = '0%';
    $('cpuBar').style.width = '0%';
  }
}

/** The address card depends on how this server is exposed. */
export function renderTunnel() {
  const mode = S.server?.exposure || 'tunnel';
  const { status, address } = S.tunnel;
  const tag = $('tunnelTag');

  let shown = null;
  let hint = '';

  if (mode === 'tunnel') {
    tag.hidden = false;
    tag.textContent = status === 'running' ? t('panel.tunnelLive')
      : status === 'starting' ? t('panel.tunnelOpening')
      : t('panel.tunnelNone');
    tag.className = `tag ${status === 'running' ? 'live' : ''}`;
    shown = address;
    hint = address ? t('panel.addressHintTunnel')
      : S.server?.ngrokToken ? t('panel.addressHintStart')
      : t('panel.addressHintToken');
  } else if (mode === 'portforward') {
    tag.hidden = true;
    const port = S.server?.port || 25565;
    shown = S.net.publicIp ? `${S.net.publicIp}:${port}` : null;
    hint = t('panel.addressHintForward');
  } else {
    tag.hidden = true;
    const port = S.server?.port || 25565;
    shown = S.net.localIp ? `${S.net.localIp}:${port}` : null;
    hint = t('panel.addressHintLan');
  }

  $('addrPublic').textContent = shown || '—';
  $('btnCopyPublic').disabled = !shown;
  $('addrHint').textContent = hint;
}

api.server.onState((st) => { S.state = st; renderServer(); });
api.ngrok.onState((s) => { S.tunnel = s; renderTunnel(); });

api.server.onStats((sample) => {
  S.history.push(sample);
  if (S.history.length > 1200) S.history.shift();
  renderPerf(sample);

  const { ramMb, cpuPercent } = sample;
  $('ramValue').textContent = ramMb > 1024 ? `${(ramMb / 1024).toFixed(1)} GB` : `${ramMb} MB`;
  const ramPct = Math.min(100, Math.round((ramMb / 1024 / (S.server?.ramGb || 4)) * 100));
  const rb = $('ramBar');
  rb.style.width = `${ramPct}%`;
  rb.className = ramPct > 90 ? 'hot' : ramPct > 75 ? 'warn' : '';
  if (Number.isFinite(cpuPercent)) {
    $('cpuValue').textContent = `${cpuPercent.toFixed(0)} %`;
    const cb = $('cpuBar');
    cb.style.width = `${Math.min(100, cpuPercent)}%`;
    cb.className = cpuPercent > 90 ? 'hot' : cpuPercent > 70 ? 'warn' : '';
  }
});

api.server.onCrash(({ reason }) => {
  const message =
    reason === 'port' ? t('crash.port', { port: S.server?.port || 25565 })
    : reason === 'eula' ? t('crash.eula')
    : reason === 'mods' ? t('crash.mods')
    : t('crash.unknown');

  toast(message, 'error');

  // A mod mismatch is only readable in the console, so take them there.
  if (reason === 'mods') go('consola');
});
