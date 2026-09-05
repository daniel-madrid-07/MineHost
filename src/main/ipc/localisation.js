/**
 * Language list and string bundles.
 */

const Settings = require('../settings');
const i18n = require('../i18n');
const catalog = require('../catalog');
const { ctx, loadStrings, handle, t } = require('../context');

handle('i18n:bundle', (lang) => {
  const id = lang || Settings.get('language') || 'en';
  return { id, strings: i18n.bundle(id), languages: i18n.available() };
});

handle('i18n:set', (lang) => {
  Settings.merge({ language: lang });
  loadStrings();
  ctx.tray?.refresh();
  // The settings catalogue is translated in this process, so a language change
  // has to hand back a fresh copy or that tab keeps the old wording.
  return { id: lang, strings: i18n.bundle(lang), catalog: catalog.localise(t) };
});
