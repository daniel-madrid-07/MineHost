import { $, S, api } from '../core/dom.js';

$('cfgTray').addEventListener('change', async (e) => {
  S.settings = await api.settings.get();
  await api.tray.set(e.target.checked);
  S.settings.minimiseToTray = e.target.checked;
});

$('cfgAutoLaunch').addEventListener('change', async (e) => {
  const res = await api.tray.autoLaunch(e.target.checked);
  e.target.checked = !!res.enabled;
});
