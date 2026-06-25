#!/bin/bash
# Phase 20 build — v1.5.15
#   • Employee direct-login link in the installer cloud box (?c=<company>)
#   • FULL frontend embed re-sync → fixes browser(1.5.11)/app(1.5.14) version mismatch
#   • Ships P4 (desktop free-forever tier) + P3 (web free card), already in the tree
# NOTE: version is read from package.json (set it BEFORE running). Both the installer
#       package.json (app version) and the parent package.json (VITE_APP_VERSION →
#       browser version) must already be on the same version.
set -e
ROOT="/Users/macbook/TexaCore-Backups-2026-03-25/erpsystem supabase"
INST="$ROOT/texacore-installer"
cd "$INST"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
VER=$(node -p "require('$INST/package.json').version")
PVER=$(node -p "require('$ROOT/package.json').version")
echo "═══ Building TexaCore ERP — installer v$VER / frontend v$PVER ═══"
if [ "$VER" != "$PVER" ]; then echo "✗ version mismatch installer($VER) vs parent($PVER) — abort"; exit 1; fi

# refresh buildDate to the actual build time
/usr/bin/sed -i '' "s#\"buildDate\": \".*\"#\"buildDate\": \"$TS\"#" package.json

echo "═══ 1) build frontend + embed (FULL — rebuilds the embedded browser bundle) ═══"
( cd "$ROOT" && npm run build:installer )   # fail-fast: no pipe, so set -e catches vite errors

echo "═══ 2) build mac (electron-builder) ═══"
rm -rf dist/mac-arm64 dist/*.dmg dist/*.dmg.blockmap 2>/dev/null || true
npm run build:mac 2>&1 | tail -3 || true

echo "═══ 3) sign + rebuild dmg ═══"
APP="dist/mac-arm64/TexaCore ERP.app"
codesign --force --deep --sign - "$APP"
codesign --verify --deep "$APP" && echo "  ✓ signed"
cd dist
rm -rf dmg-stage "TexaCore ERP-$VER-arm64.dmg" "TexaCore-ERP-$VER-arm64.dmg"
mkdir -p dmg-stage
ditto "mac-arm64/TexaCore ERP.app" "dmg-stage/TexaCore ERP.app"
ln -s /Applications "dmg-stage/Applications"
hdiutil create -volname "TexaCore ERP" -srcfolder dmg-stage -ov -format UDZO "TexaCore ERP-$VER-arm64.dmg" >/dev/null
rm -rf dmg-stage
cp "TexaCore ERP-$VER-arm64.dmg" "TexaCore-ERP-$VER-arm64.dmg"
SHA=$(openssl dgst -sha512 -binary "TexaCore-ERP-$VER-arm64.dmg" | openssl base64 -A)
SIZE=$(stat -f%z "TexaCore-ERP-$VER-arm64.dmg")
printf 'version: %s\nfiles:\n  - url: TexaCore-ERP-%s-arm64.dmg\n    sha512: %s\n    size: %s\npath: TexaCore-ERP-%s-arm64.dmg\nsha512: %s\nreleaseDate: '\''%s'\''\n' "$VER" "$VER" "$SHA" "$SIZE" "$VER" "$SHA" "$TS" > latest-mac.yml
cp "TexaCore ERP-$VER-arm64.dmg" "$HOME/Desktop/TexaCore ERP-$VER-arm64.dmg"
xattr -cr "$HOME/Desktop/TexaCore ERP-$VER-arm64.dmg" 2>/dev/null || true
echo "  ✓ dmg ready: $(stat -f%z "TexaCore-ERP-$VER-arm64.dmg") bytes | on Desktop"
echo "═══ DONE v$VER ═══"
