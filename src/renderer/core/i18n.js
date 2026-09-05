/**
 * String lookup. The main process owns the catalogue; this only reads it
 * and fills placeholders.
 */

import { S } from './dom.js';

/** Looks up a string and fills {placeholders}. Falls back to the key itself. */
export function t(key, vars) {
  let out = S.strings[key];
  if (out == null) return key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

/** Re-renders every static string marked up in the HTML. */
/** Backend errors travel as codes; show the sentence when we have one. */
export function errText(error) {
  if (!error) return '';
  const key = `err.${error}`;
  const translated = t(key);
  return translated === key ? String(error) : translated;
}

export function applyStrings() {
  document.querySelectorAll('[data-i18n]').forEach((n) => {
    n.textContent = t(n.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-ph]').forEach((n) => {
    n.placeholder = t(n.dataset.i18nPh);
  });
  document.documentElement.lang = S.lang;
}
