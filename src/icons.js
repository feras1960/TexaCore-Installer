// ═══════════════════════════════════════
// TexaCore Installer — icons (browser-global, no modules, no network).
//
// The launcher window used EMOJI as icons. Windows (and above all Windows Server) draws them flat, monochrome and at uneven sizes — the Mac's Apple Color Emoji
// hid the problem. Every icon here is an inline SVG drawn with `currentColor`, so it follows the text colour, scales with the font and looks the same on
// every system; nothing is fetched (no CDN, no icon font).
//
// The shapes are from Lucide (https://lucide.dev), ISC License:
//   Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.
//   Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice
//   and this permission notice appear in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES (…full text: THIRD_PARTY_NOTICES.md).
//
// Use:  markup   <svg class="icon icon-20" aria-hidden="true"><use href="#i-key"/></svg>        (the sprite is injected below, before the first paint)
//       script   icon('key', 20)  → an SVG string;  iconEl('key', 20) → a node;  setWithIcon(el, 'check', 'text') → icon + text
//       status   .feedback.success / .error / .info / .loading get their icon from CSS (::before) — see styles.css
// Sizes (one per context): 16 inline · 20 buttons · 28 status cards / step headers · 32 large headers.
// ═══════════════════════════════════════
const ICONS = {
  'wifi': '<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/>',
  'external-link': '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  'power': '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  'file': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  'life-buoy': '<circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/>',
  'database': '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  'key': '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  'circle-check': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'circle-x': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  'triangle-alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'info': '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'loader': '<path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/>',
  'lock': '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  'play': '<polygon points="6 3 20 12 6 21 6 3"/>',
  'cloud': '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  'settings': '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  'folder-open': '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  'pause': '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  'rotate-cw': '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  'wifi-off': '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
  'hard-drive': '<line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/>',
  'clock': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
};

const ICON_NS = 'http://www.w3.org/2000/svg';
const ICON_SVG_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

/** An inline icon as an SVG string (markup built in script). `size` picks the .icon-<size> class (16 / 20 / 28 / 32). */
function icon(name, size = 16, extraClass = '') {
  if (!ICONS[name]) return '';
  return `<svg class="icon icon-${size}${extraClass ? ' ' + extraClass : ''}" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
}

/** An icon as a DOM node. */
function iconEl(name, size = 16, extraClass = '') {
  const tpl = document.createElement('template');
  tpl.innerHTML = icon(name, size, extraClass);
  return tpl.content.firstChild;
}

/** Replace the children of `el` with an icon followed by `text` (text is a text node: never parsed as HTML). */
function setWithIcon(el, name, text, size = 16, extraClass = 'icon-lead') {
  if (!el) return;
  el.textContent = '';
  const i = iconEl(name, size, extraClass);
  if (i) el.appendChild(i);
  el.appendChild(document.createTextNode(text == null ? '' : String(text)));
}

/** Replace the children of `el` with ONLY an icon (a button whose label is an icon, the update banner's state icon). */
function setIconOnly(el, name, size = 16) {
  if (!el) return;
  el.textContent = '';
  const i = iconEl(name, size);
  if (i) el.appendChild(i);
}

// ─── the sprite (one <symbol> per icon) and the CSS variables the stylesheet uses for the ::before icons of status lines ───
(function mountIcons() {
  try {
    const symbols = Object.entries(ICONS).map(([n, body]) => `<symbol id="i-${n}" ${ICON_SVG_ATTRS}>${body}</symbol>`).join('');
    const mount = () => {
      if (document.getElementById('icon-sprite')) return;
      const host = document.createElement('div');
      host.id = 'icon-sprite';
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
      host.innerHTML = `<svg xmlns="${ICON_NS}" width="0" height="0" focusable="false"><defs>${symbols}</defs></svg>`;
      document.body.insertBefore(host, document.body.firstChild);
    };
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
    const root = document.documentElement.style;
    for (const [n, body] of Object.entries(ICONS)) {
      const svg = `<svg xmlns="${ICON_NS}" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
      root.setProperty(`--ico-${n}`, `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
    }
  } catch (e) { /* icons are decoration: never break the window */ }
})();

if (typeof window !== 'undefined') {
  window.ICONS = ICONS; window.icon = icon; window.iconEl = iconEl; window.setWithIcon = setWithIcon; window.setIconOnly = setIconOnly;
}
