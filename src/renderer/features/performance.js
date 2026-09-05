import { $, S } from '../core/dom.js';
import { t } from '../core/i18n.js';

S.history = [];

/** Colours a bar and its value by how close the reading is to trouble. */
function gradeBar(bar, value, warnAt, hotAt) {
  bar.style.width = `${Math.max(0, Math.min(100, value))}%`;
  bar.className = value >= hotAt ? 'hot' : value >= warnAt ? 'warn' : '';
}

export function renderPerf(sample) {
  const card = $('perfCard');
  if (!card) return;

  const running = S.state.status === 'running';
  card.hidden = !running;
  if (!running || !sample) return;

  // Ticks per second: 20 is the target, so the bar fills from there down.
  const tpsEl = $('perfTps');
  if (!Number.isFinite(sample.tps)) {
    tpsEl.textContent = t('perf.unknown');
    tpsEl.className = 'perf-value unknown';
    $('perfTpsBar').style.width = '0%';
    $('perfVerdict').textContent = '';
    $('perfVerdict').className = 'tag';
  } else {
    const tps = sample.tps;
    tpsEl.textContent = tps.toFixed(1);
    tpsEl.className = `perf-value ${tps < 12 ? 'hot' : tps < 17 ? 'warn' : ''}`;
    const bar = $('perfTpsBar');
    bar.style.width = `${Math.max(0, Math.min(100, (tps / 20) * 100))}%`;
    bar.className = tps < 12 ? 'hot' : tps < 17 ? 'warn' : '';

    const verdict = $('perfVerdict');
    verdict.textContent = t(tps >= 17 ? 'perf.good' : tps >= 12 ? 'perf.fair' : 'perf.poor');
    verdict.className = `tag ${tps >= 17 ? 'live' : ''}`;
  }

  // Milliseconds per tick: 50 ms is the budget for one tick.
  const msptEl = $('perfMspt');
  if (!Number.isFinite(sample.mspt)) {
    msptEl.textContent = t('perf.unknown');
    msptEl.className = 'perf-value unknown';
    $('perfMsptBar').style.width = '0%';
  } else {
    msptEl.textContent = `${sample.mspt.toFixed(1)} ms`;
    msptEl.className = `perf-value ${sample.mspt > 50 ? 'hot' : sample.mspt > 35 ? 'warn' : ''}`;
    gradeBar($('perfMsptBar'), (sample.mspt / 50) * 100, 70, 100);
  }

  const ramGb = sample.ramMb / 1024;
  const ramPct = Math.min(100, (ramGb / (S.server?.ramGb || 4)) * 100);
  $('perfRam').textContent = ramGb >= 1 ? `${ramGb.toFixed(1)} GB` : `${sample.ramMb} MB`;
  $('perfRam').className = `perf-value num ${ramPct > 90 ? 'hot' : ramPct > 75 ? 'warn' : ''}`;
  gradeBar($('perfRamBar'), ramPct, 75, 90);

  if (!Number.isFinite(sample.cpuPercent)) {
    $('perfCpu').textContent = '—';
    $('perfCpu').className = 'perf-value num';
    $('perfCpuBar').style.width = '0%';
  } else {
    $('perfCpu').textContent = `${sample.cpuPercent.toFixed(0)} %`;
    $('perfCpu').className = `perf-value num ${sample.cpuPercent > 90 ? 'hot' : sample.cpuPercent > 70 ? 'warn' : ''}`;
    gradeBar($('perfCpuBar'), sample.cpuPercent, 70, 90);
  }

  drawSpark();
}

/** Sparkline of recent tick rate, or memory when tick rate is unavailable. */
function drawSpark() {
  const line = $('sparkLine');
  const fill = $('sparkFill');
  if (!line) return;

  const points = S.history.slice(-100);
  if (points.length < 2) {
    line.setAttribute('d', '');
    fill.setAttribute('d', '');
    $('perfWindow').textContent = '';
    return;
  }

  const useTps = points.some((p) => p.tps != null);
  const values = points.map((p) => (useTps
    ? (p.tps == null ? 20 : p.tps)
    : Math.min(100, (p.ramMb / 1024 / (S.server?.ramGb || 4)) * 100)));

  const max = useTps ? 20 : 100;
  const w = 300;
  const h = 48;
  const step = w / (values.length - 1);

  const coords = values.map((v, i) => {
    const x = i * step;
    const y = h - Math.max(0, Math.min(1, v / max)) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  line.setAttribute('d', `M${coords.join(' L')}`);
  fill.setAttribute('d', `M0,${h} L${coords.join(' L')} L${w},${h} Z`);

  const minutes = Math.max(1, Math.round((points.length * 3) / 60));
  $('perfWindow').textContent = t('perf.window', { n: minutes });
}
