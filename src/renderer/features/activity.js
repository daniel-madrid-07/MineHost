import { $, S, api, el } from '../core/dom.js';
import { emptyState } from '../ui/feedback.js';
import { t } from '../core/i18n.js';

/* Which chip shows which kinds. */
const EVENT_GROUPS = {
  players: ['join', 'leave', 'death', 'op', 'deop', 'ban', 'kick', 'whitelistAdd', 'whitelistRemove'],
  progress: ['advancement', 'challenge', 'goal', 'sleep'],
  chat: ['chat', 'me'],
  server: ['ready', 'stopping', 'saved', 'overloaded', 'worldPrepared', 'error'],
};

S.eventFilter = 'all';

const eventVisible = (kind) =>
  S.eventFilter === 'all' || (EVENT_GROUPS[S.eventFilter] || []).includes(kind);

/** Renders one event as a line of plain language rather than a log entry. */
function eventLine(e) {
  const row = el('div', `ev ${e.kind}`);
  if (!eventVisible(e.kind)) row.hidden = true;

  row.append(el('span', 'ev-time', new Date(e.ts).toLocaleTimeString(S.lang, {
    hour: '2-digit', minute: '2-digit',
  })));
  row.append(el('i', 'ev-mark'));

  const body = el('div', 'ev-body');

  if (e.kind === 'chat' || e.kind === 'me') {
    body.append(el('b', null, e.player), el('span', null, ` ${e.text}`));
  } else if (e.kind === 'death') {
    // The server already writes a colourful sentence; keep it verbatim.
    body.append(el('span', null, e.text));
  } else if (['advancement', 'challenge', 'goal'].includes(e.kind)) {
    const parts = t(`events.${e.kind}`, { player: '\u0000', text: '\u0001' }).split(/[\u0000\u0001]/);
    body.append(
      el('span', null, parts[0] || ''),
      el('b', null, e.player),
      el('span', null, parts[1] || ' '),
      el('b', null, e.text),
      el('span', null, parts[2] || '')
    );
  } else {
    const key = `events.${e.kind}`;
    const text = t(key, { player: e.player || '', ms: e.ms || 0 });
    body.append(el('span', null, text === key ? e.text : text));
  }

  row.append(body);
  return row;
}

function addEvent(e) {
  const feed = $('eventFeed');
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;

  // Drop the empty state the first time something arrives.
  const empty = feed.querySelector('.empty');
  if (empty) feed.innerHTML = '';

  feed.append(eventLine(e));
  while (feed.childElementCount > 400) feed.firstElementChild.remove();
  if (atBottom) feed.scrollTop = feed.scrollHeight;
}

export function renderEventFeed(list) {
  const feed = $('eventFeed');
  feed.innerHTML = '';
  if (!list.length) {
    emptyState(feed, 'pulse', t('events.empty'), t('events.emptyHint'));
    return;
  }
  for (const e of list) feed.append(eventLine(e));
  feed.scrollTop = feed.scrollHeight;
}

api.server.onEvent((e) => {
  S.events.push(e);
  if (S.events.length > 400) S.events.shift();
  addEvent(e);
});

$('eventFilters').addEventListener('click', (ev) => {
  const chip = ev.target.closest('.chip');
  if (!chip) return;
  S.eventFilter = chip.dataset.filter;
  $('eventFilters').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
  renderEventFeed(S.events);
});

$('btnClearEvents').addEventListener('click', () => {
  S.events = [];
  renderEventFeed([]);
});
