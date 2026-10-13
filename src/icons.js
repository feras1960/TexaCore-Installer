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
  'database': '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  'key': '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  'factory': '<path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M17 18h1"/><path d="M12 18h1"/><path d="M7 18h1"/>',
  'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  'circle-check': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'circle-x': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  'triangle-alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'info': '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  'check': '<path d="M20 6 9 17l-5-5"/>',
  'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'loader': '<path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/>',
  'lock': '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'zap': '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  'gift': '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  'shopping-cart': '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  'play': '<polygon points="6 3 20 12 6 21 6 3"/>',
  'square': '<rect width="14" height="14" x="5" y="5" rx="2"/>',
  'globe': '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  'cloud': '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  'settings': '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'sparkles': '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
  'folder-open': '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
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
