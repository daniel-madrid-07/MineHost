/**
 * Thin wrappers over the DOM and the single shared state object.
 * Everything else in the renderer builds on these four helpers.
 */

export const api = window.mh;
export const $ = (id) => document.getElementById(id);
export const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
export const icon = (name) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ic');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
};

/**
 * Puts the icon sprite in the document. Every `icon()` above points into it by
 * id, so this has to finish before anything renders.
 */
export async function loadIcons() {
  const host = $('iconSprite');
  if (!host || host.childElementCount) return;
  try {
    host.innerHTML = await (await fetch('icons.svg')).text();
  } catch (err) {
    // Without the sprite the app still works; it just loses its glyphs.
    console.error('No se pudo cargar icons.svg', err);
  }
}

export const S = {
  settings: {},
  server: null,          // active server entry
  servers: [],
  info: {},
  meta: {},
  state: { status: 'stopped', players: [] },
  tunnel: { status: 'stopped', address: null },
  net: {},
  view: 'panel',
  uptimeTimer: null,
  props: {},
  propsDirty: {},
  playerTab: 'ops',
  players: { ops: [], whitelist: [], bans: [], ipBans: [] },
  strings: {},
  lang: 'en',
  events: [],
};
