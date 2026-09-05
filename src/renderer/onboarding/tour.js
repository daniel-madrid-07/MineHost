import { $, S, api, el } from '../core/dom.js';
import { closeMenus } from '../features/console-shortcuts.js';
import { go } from '../ui/navigation.js';
import { t } from '../core/i18n.js';
import { wizard } from './wizard.js';

export const tour = {
  i: 0,
  steps: [],

  /** The access step depends on how this server was set up. */
  build() {
    const mode = S.server?.exposure || 'tunnel';
    const accessStep = mode === 'portforward'
      ? { target: '[data-tour="access"]', title: 'tour.forwardTitle', text: 'tour.forwardText',
          view: 'ajustes', tab: { container: 'settingsTabs', name: 'acceso' } }
      : mode === 'lan'
      ? { target: '[data-tour="access"]', title: 'tour.lanTitle', text: 'tour.lanText',
          view: 'ajustes', tab: { container: 'settingsTabs', name: 'acceso' } }
      : { target: '[data-tour="ngrok"]', title: 'tour.tunnelTitle', text: 'tour.tunnelText',
          view: 'ajustes', tab: { container: 'settingsTabs', name: 'acceso' } };

    this.steps = [
      { target: '[data-tour="power"]', title: 'tour.powerTitle', text: 'tour.powerText', view: 'panel' },
      { target: '[data-tour="address"]', title: 'tour.addressTitle', text: 'tour.addressText', view: 'panel' },
      accessStep,
      { target: '.nav-item[data-view="copias"]', title: 'tour.backupTitle', text: 'tour.backupText', view: 'panel' },
      { target: '[data-tour="servers"]', title: 'tour.serversTitle', text: 'tour.serversText', view: 'panel' },
    ];
  },

  async start() {
    this.build();
    this.i = 0;
    $('tour').hidden = false;
    await this.show();
  },

  async show() {
    const step = this.steps[this.i];

    if (step.view && S.view !== step.view) go(step.view);
    if (step.tab) {
      $(step.tab.container).querySelector(`.tab[data-tab="${step.tab.name}"]`)?.click();
    }
    await new Promise((r) => setTimeout(r, 180));

    const node = document.querySelector(step.target);
    if (!node) return this.next();

    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await new Promise((r) => setTimeout(r, 220));

    const r = node.getBoundingClientRect();
    const pad = 6;
    const box = { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };

    for (const id of ['tourHole', 'tourRing']) {
      const n = $(id);
      n.setAttribute('x', box.x);
      n.setAttribute('y', box.y);
      n.setAttribute('width', box.w);
      n.setAttribute('height', box.h);
    }

    $('tourStep').textContent = t('wizard.step', { n: this.i + 1, total: this.steps.length });
    $('tourTitle').textContent = t(step.title);
    $('tourText').textContent = t(step.text);
    $('tourNext').textContent = this.i === this.steps.length - 1 ? t('tour.done') : t('tour.next');

    const dots = $('tourDots');
    dots.innerHTML = '';
    this.steps.forEach((_, idx) => dots.append(el('i', idx === this.i ? 'on' : '')));

    this.place(box);
  },

  /** Places the bubble on whichever side has room, never over the cutout. */
  place(box) {
    const pop = $('tourPop');
    const popW = 312;
    const popH = pop.offsetHeight || 160;
    const gap = 14;
    const margin = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const spots = [
      { x: box.x + box.w + gap, y: box.y, fits: box.x + box.w + gap + popW <= vw - margin },
      { x: box.x - popW - gap, y: box.y, fits: box.x - popW - gap >= margin },
      { x: box.x, y: box.y + box.h + gap, fits: box.y + box.h + gap + popH <= vh - margin },
      { x: box.x, y: box.y - popH - gap, fits: box.y - popH - gap >= margin },
    ];

    const spot = spots.find((sp) => sp.fits) || spots[2];
    pop.style.transform = `translate(${
      Math.min(Math.max(margin, spot.x), vw - popW - margin)}px, ${
      Math.min(Math.max(margin, spot.y), vh - popH - margin)}px)`;
  },

  next() {
    if (this.i >= this.steps.length - 1) return this.finish();
    this.i++;
    this.show();
  },

  async finish() {
    $('tour').hidden = true;
    S.settings = await api.settings.set({ onboardingDone: true });
  },
};

$('tourNext').addEventListener('click', () => tour.next());
$('tourSkip').addEventListener('click', () => tour.finish());
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closeMenus();
  if (!$('tour').hidden) tour.finish();
  else if (!$('wizard').hidden) wizard.close();
  else if (!$('pickerScrim').hidden) $('pickerScrim').hidden = true;
});
