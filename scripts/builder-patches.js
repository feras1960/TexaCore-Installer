'use strict';
// Loaded into electron-builder with `node -r ./scripts/builder-patches.js` (see package.json build scripts).
// electron-builder names the Arabic licence "ar-SA" for the dmg's licence screen, but the dmg-license package only knows the tag "ar"
// (Mac Arabic, x-mac-arabic) — the build would stop with "No known languages found for specification ar-SA". Map Arabic to the tag that exists.
const langs = require('app-builder-lib/out/util/langs');
const original = langs.toLangWithRegion;
langs.toLangWithRegion = (lang) => (String(lang).toLowerCase() === 'ar' ? 'ar' : original(lang));
