import { $, S, api } from '../core/dom.js';
import { t } from '../core/i18n.js';

export function renderWakeHint({ enabled, listening }) {
  const hint = $('wakeHint');
  if (!enabled) {
    hint.textContent = '';
    return;
  }
  hint.textContent = listening ? t('wake.listening') : t('wake.needsStopped');
  hint.style.color = listening ? 'var(--accent)' : 'var(--warn)';
}

async function saveWake() {
  const enabled = $('cfgWake').checked;
  const minutes = Math.max(1, +$('cfgWakeIdle').value || 10);
  const res = await api.wake.set(enabled, minutes);
  S.wake = { enabled, listening: res.listening };
  renderWakeHint(S.wake);
}

$('cfgWake').addEventListener('change', saveWake);
$('cfgWakeIdle').addEventListener('change', saveWake);
