import { $, S, api, el, icon } from '../core/dom.js';
import { fillVersions } from '../features/settings.js';
import { reloadActive } from '../app.js';
import { t } from '../core/i18n.js';
import { taskEnd, taskStart, toast } from '../ui/feedback.js';
import { tour } from './tour.js';

export const wizard = {
  step: 0,
  steps: ['name', 'folder', 'platform', 'version', 'access'],
  data: {},

  open() {
    this.step = 0;
    this.data = { name: '', folder: '', platform: 'neoforge', version: null, exposure: 'tunnel' };
    $('wizard').hidden = false;
    this.render();
  },

  close() { $('wizard').hidden = true; },

  async render() {
    const total = this.steps.length;
    const kind = this.steps[this.step];

    $('wzStep').textContent = t('wizard.step', { n: this.step + 1, total });
    $('wzProgress').style.width = `${((this.step + 1) / total) * 100}%`;
    $('wzBack').style.visibility = this.step === 0 ? 'hidden' : 'visible';
    $('wzNext').textContent = this.step === total - 1 ? t('wizard.install') : t('wizard.next');

    const content = $('wzContent');
    content.innerHTML = '';

    if (kind === 'name') {
      $('wzTitle').textContent = t('wizard.nameTitle');
      $('wzText').textContent = t('wizard.nameText');
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = t('wizard.namePlaceholder');
      input.value = this.data.name;
      input.addEventListener('input', () => { this.data.name = input.value; });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.next(); });
      content.append(input);
      setTimeout(() => input.focus(), 60);
    }

    if (kind === 'folder') {
      $('wzTitle').textContent = t('wizard.folderTitle');
      $('wzText').textContent = t('wizard.folderText');
      const row = el('div', 'row-inline');
      const input = document.createElement('input');
      input.type = 'text';
      input.readOnly = true;
      input.placeholder = t('wizard.folderNone');
      input.value = this.data.folder;
      const pick = el('button', 'btn btn-quiet', t('settings.choose'));
      pick.addEventListener('click', async () => {
        const f = await api.dialog.pickFolder();
        if (f) { this.data.folder = f; input.value = f; }
      });
      row.append(input, pick);
      content.append(row);
    }

    if (kind === 'platform') {
      $('wzTitle').textContent = t('wizard.platformTitle');
      $('wzText').textContent = t('wizard.platformText');
      const list = el('div', 'wz-list');
      for (const pf of S.meta.platforms) {
        const btn = el('button', `pick ${pf.id === this.data.platform ? 'sel' : ''}`);
        const main = el('div', 'pick-main');
        main.append(el('b', null, pf.name), el('span', null, pf.blurb));
        btn.append(main, icon('check'));
        btn.addEventListener('click', () => {
          this.data.platform = pf.id;
          this.data.version = null;
          list.querySelectorAll('.pick').forEach((n) => n.classList.toggle('sel', n === btn));
        });
        list.append(btn);
      }
      content.append(list);
    }

    if (kind === 'version') {
      $('wzTitle').textContent = t('wizard.versionTitle');
      $('wzText').textContent = t('wizard.versionText');

      const sel = document.createElement('select');
      sel.innerHTML = `<option>${t('common.loading')}</option>`;
      content.append(sel);

      const toggle = el('label', 'check-row');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!S.settings.showBetaVersions;
      toggle.append(box, el('span', null, t('versions.showBeta')));

      const warn = el('small', 't-caption');
      warn.style.color = 'var(--warn)';
      warn.textContent = box.checked ? t('versions.betaHint') : '';
      content.append(toggle, warn);

      const pick = () => {
        try { this.data.version = JSON.parse(sel.value); } catch (_) { this.data.version = null; }
      };

      let all = [];
      try {
        all = await api.installer.versions(this.data.platform);
        fillVersions(sel, all);
        pick();
      } catch (_) {
        sel.innerHTML = `<option>${t('common.offline')}</option>`;
      }

      sel.addEventListener('change', pick);
      box.addEventListener('change', async () => {
        S.settings = await api.settings.set({ showBetaVersions: box.checked });
        warn.textContent = box.checked ? t('versions.betaHint') : '';
        $('cfgShowBeta').checked = box.checked;
        fillVersions(sel, all);
        pick();
      });
    }

    if (kind === 'access') {
      $('wzTitle').textContent = t('wizard.accessTitle');
      $('wzText').textContent = t('wizard.accessText');
      const list = el('div', 'wz-list');
      const modes = [
        ['tunnel', 'access.tunnel', 'access.tunnelBlurb'],
        ['portforward', 'access.forward', 'access.forwardBlurb'],
        ['lan', 'access.lan', 'access.lanBlurb'],
      ];
      for (const [id, title, blurb] of modes) {
        const btn = el('button', `pick ${id === this.data.exposure ? 'sel' : ''}`);
        const main = el('div', 'pick-main');
        main.append(el('b', null, t(title)), el('span', null, t(blurb)));
        btn.append(main, icon('check'));
        btn.addEventListener('click', () => {
          this.data.exposure = id;
          list.querySelectorAll('.pick').forEach((n) => n.classList.toggle('sel', n === btn));
        });
        list.append(btn);
      }
      content.append(list);
    }
  },

  async next() {
    const kind = this.steps[this.step];
    if (kind === 'name' && !this.data.name.trim()) return toast(t('wizard.needName'), 'warn');
    if (kind === 'folder' && !this.data.folder) return toast(t('wizard.needFolder'), 'warn');

    if (this.step < this.steps.length - 1) {
      this.step++;
      return this.render();
    }
    if (!this.data.version) return toast(t('wizard.needVersion'), 'warn');

    this.close();

    const entry = await api.servers.add({
      name: this.data.name.trim(),
      serverPath: this.data.folder,
      platform: this.data.platform,
      exposure: this.data.exposure,
    });

    taskStart(t('wizard.installing'));
    const r = await api.installer.install({
      serverId: entry.id,
      serverPath: this.data.folder,
      platformId: this.data.platform,
      minecraft: this.data.version.minecraft,
      build: this.data.version.build,
    });
    taskEnd();

    if (r.ok === false) return toast(r.error, 'error');

    await reloadActive();
    toast(t('wizard.ready'));

    if (!S.settings.onboardingDone) setTimeout(() => tour.start(), 450);
  },
};

$('btnStartWizard').addEventListener('click', () => wizard.open());
$('wzNext').addEventListener('click', () => wizard.next());
$('wzBack').addEventListener('click', () => { wizard.step--; wizard.render(); });
$('wzCancel').addEventListener('click', () => wizard.close());
