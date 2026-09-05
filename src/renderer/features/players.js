import { $, S, api, el } from '../core/dom.js';
import { emptyState, toast } from '../ui/feedback.js';
import { errText, t } from '../core/i18n.js';
import { wireTabs } from '../ui/navigation.js';

wireTabs('playerTabs', (tab) => { S.playerTab = tab; renderPlayers(); });

/* Caption keys per tab; the placeholder for IPs is an example, not a word. */
const PLAYER_COPY = {
  ops:       { hint: 'players.opsHint', ph: 'players.namePh' },
  whitelist: { hint: 'players.whitelistHint', ph: 'players.namePh' },
  bans:      { hint: 'players.bansHint', ph: 'players.namePh' },
  ipBans:    { hint: 'players.ipBansHint', ph: null },
};

export async function refreshPlayers() {
  if (!S.server?.serverPath) return;
  S.players = await api.players.read(S.server?.serverPath);
  renderPlayers();
}

export function renderPlayers() {
  const tab = S.playerTab;
  $('plHint').textContent = t(PLAYER_COPY[tab].hint);
  $('plInput').placeholder = PLAYER_COPY[tab].ph ? t(PLAYER_COPY[tab].ph) : '192.168.1.20';

  const box = $('plList');
  const items = S.players[tab] || [];
  if (!items.length) {
    emptyState(box, 'players', t('players.empty'),
      t(tab === 'ops' ? 'players.emptyOps' : 'players.emptyOther'));
    return;
  }

  box.innerHTML = '';
  for (const entry of items) {
    const label = entry.name || entry.ip;
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.append(el('span', 'row-title', label));
    if (entry.reason) main.append(el('span', 'row-sub', entry.reason));
    else if (entry.level) main.append(el('span', 'row-sub', t('players.level', { n: entry.level })));

    const del = el('button', 'btn btn-quiet btn-sm',
      tab === 'bans' || tab === 'ipBans' ? t('players.unban') : t('players.remove'));
    del.addEventListener('click', async () => {
      const r = await api.players.mutate(tab, 'remove', label);
      if (r.ok) {
        toast(t(r.needsRestart ? 'players.removedRestart' : 'players.removed', { name: label }),
          r.needsRestart ? 'warn' : 'ok');
        setTimeout(refreshPlayers, 400);
      } else toast(errText(r.error), 'error');
    });

    const actions = el('div', 'row-actions');
    actions.append(del);
    row.append(main, actions);
    box.append(row);
  }
}

async function addPlayer() {
  const input = $('plInput');
  const value = input.value.trim();
  if (!value) return;
  $('plAdd').disabled = true;
  const r = await api.players.mutate(S.playerTab, 'add', value);
  $('plAdd').disabled = false;
  if (r.ok) {
    input.value = '';
    toast(t(r.needsRestart ? 'players.addedRestart' : 'players.added', { name: value }),
      r.needsRestart ? 'warn' : 'ok');
    setTimeout(refreshPlayers, 500);
  } else toast(errText(r.error), 'error');
}
$('plAdd').addEventListener('click', addPlayer);
$('plInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addPlayer(); });
