import { $, S, api, el, icon } from '../core/dom.js';
import { errText, t } from '../core/i18n.js';
import { promptText } from './server-picker.js';
import { toast } from '../ui/feedback.js';

/** Lets the user pick a player from those online. */
function pickPlayer(title, exclude = null) {
  const options = S.state.players.filter((p) => p !== exclude);
  if (!options.length) {
    toast(t('cmd.nobodyOnline'), 'warn');
    return Promise.resolve(null);
  }
  return chooseFrom(title, options);
}

/** A small list dialog, reusing the prompt modal shell. */
function chooseFrom(title, options) {
  return new Promise((resolve) => {
    $('pmTitle').textContent = title;

    const input = $('pmInput');
    input.hidden = true;

    const list = el('div', 'choice-list');
    for (const value of options) {
      const btn = el('button', 'pick');
      const main = el('div', 'pick-main');
      main.append(el('b', null, value));
      btn.append(main, icon('check'));
      btn.addEventListener('click', () => done(value));
      list.append(btn);
    }
    input.after(list);
    $('promptScrim').hidden = false;

    const done = (v) => {
      $('promptScrim').hidden = true;
      input.hidden = false;
      list.remove();
      $('pmYes').removeEventListener('click', ok);
      $('pmNo').removeEventListener('click', no);
      resolve(v);
    };
    const ok = () => done(null);
    const no = () => done(null);
    $('pmYes').addEventListener('click', ok);
    $('pmNo').addEventListener('click', no);
  });
}

async function runShortcut(cmd) {
  const r = await api.server.command(cmd);
  if (!r.ok) return toast(errText(r.error), 'error');
  toast(`/${cmd}`);
}

export function closeMenus() {
  document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
}

$('shortcuts').addEventListener('click', async (e) => {
  const trigger = e.target.closest('.menu-trigger');
  if (trigger) {
    const menu = trigger.closest('.menu');
    const wasOpen = menu.classList.contains('open');
    closeMenus();
    if (!wasOpen) menu.classList.add('open');
    return;
  }

  const item = e.target.closest('.menu-list button');
  if (!item) return;
  closeMenus();

  if (S.state.status !== 'running') return toast(t('cmd.needsRunning'), 'warn');
  if (S.state.external) return toast(errText('EXTERNAL_NO_CONSOLE'), 'warn');

  // Straightforward commands carry their text on the button.
  if (item.dataset.cmd) return runShortcut(item.dataset.cmd);

  const action = item.dataset.action;

  if (action === 'tp') {
    const who = await pickPlayer(t('cmd.tpWho'));
    if (!who) return;
    const target = await pickPlayer(t('cmd.tpWhere'), who);
    if (!target) return;
    return runShortcut(`tp ${who} ${target}`);
  }

  if (action === 'gamemode') {
    const who = await pickPlayer(t('cmd.gamemodeWho'));
    if (!who) return;
    const mode = await chooseFrom(t('cmd.gamemodeWhich'),
      ['survival', 'creative', 'adventure', 'spectator']);
    if (!mode) return;
    return runShortcut(`gamemode ${mode} ${who}`);
  }

  if (action === 'give') {
    const who = await pickPlayer(t('cmd.healWho'));
    if (!who) return;
    // Restoring health and hunger together is what people mean by "heal".
    await runShortcut(`effect give ${who} minecraft:instant_health 1 10 true`);
    return runShortcut(`effect give ${who} minecraft:saturation 1 10 true`);
  }

  if (action === 'say') {
    const message = await promptText(t('cmd.sayWhat'), '');
    if (!message) return;
    return runShortcut(`say ${message}`);
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu')) closeMenus();
});
