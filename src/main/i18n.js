const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'i18n');

const LANGUAGES = [
  { id: 'en', name: 'English' },
  { id: 'es', name: 'Español' },
  { id: 'pt', name: 'Português' },
  { id: 'fr', name: 'Français' },
  { id: 'de', name: 'Deutsch' },
  { id: 'it', name: 'Italiano' },
  { id: 'ru', name: 'Русский' },
];

const cache = new Map();

function load(id) {
  if (cache.has(id)) return cache.get(id);
  try {
    const data = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'));
    cache.set(id, data);
    return data;
  } catch (_) {
    return null;
  }
}

/** English is the source of truth; anything missing falls back to it. */
function bundle(id) {
  const base = load('en') || {};
  if (id === 'en') return base;
  return { ...base, ...(load(id) || {}) };
}

function available() {
  return LANGUAGES.filter((l) => l.id === 'en' || load(l.id));
}

/** Picks the closest bundled language to the OS locale. */
function detect(locale) {
  const tag = String(locale || '').toLowerCase();
  const exact = LANGUAGES.find((l) => tag === l.id || tag.startsWith(`${l.id}-`));
  return exact && (exact.id === 'en' || load(exact.id)) ? exact.id : 'en';
}

module.exports = { bundle, available, detect, LANGUAGES };
