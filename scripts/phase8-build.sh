#!/bin/bash
# Phase 8 build — v1.5.0 (license enforcement: fix suspend/revoke + device block + recovery)
# cleanup + real invoice count + per-company delete/disable controls)
set -e
ROOT="/Users/macbook/TexaCore-Backups-2026-03-25/erpsystem supabase"
INST="$ROOT/texacore-installer"
cd "$INST"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "═══ 1) bump 1.4.9 → 1.5.0 ═══"
/usr/bin/sed -i '' 's/"version": "1.4.9"/"version": "1.5.0"/' package.json
/usr/bin/sed -i '' "s#\"buildDate\": \".*\"#\"buildDate\": \"$TS\"#" package.json
/usr/bin/sed -i '' 's/"version": "1.4.9"/"version": "1.5.0"/' "$ROOT/package.json"
echo "  $(grep '\"version\"' package.json | head -1)"

echo "═══ 2) build frontend + embed ═══"
( cd "$ROOT" && npm run build:installer 2>&1 | tail -2 )

echo "═══ 3) build mac ═══"
rm -rf dist/mac-arm64 dist/*.dmg dist/*.dmg.blockmap 2>/dev/null || true
npm run build:mac 2>&1 | tail -3 || true

echo "═══ 4) sign + rebuild dmg ═══"
APP="dist/mac-arm64/TexaCore ERP.app"
codesign --force --deep --sign - "$APP"
codesign --verify --deep "$APP" && echo "  ✓ signed"
cd dist
rm -rf dmg-stage "TexaCore ERP-1.5.0-arm64.dmg" "TexaCore-ERP-1.5.0-arm64.dmg"
mkdir -p dmg-stage
ditto "mac-arm64/TexaCore ERP.app" "dmg-stage/TexaCore ERP.app"
ln -s /Applications "dmg-stage/Applications"
hdiutil create -volname "TexaCore ERP" -srcfolder dmg-stage -ov -format UDZO "TexaCore ERP-1.5.0-arm64.dmg" >/dev/null
rm -rf dmg-stage
cp "TexaCore ERP-1.5.0-arm64.dmg" "TexaCore-ERP-1.5.0-arm64.dmg"
SHA=$(openssl dgst -sha512 -binary "TexaCore-ERP-1.5.0-arm64.dmg" | openssl base64 -A)
SIZE=$(stat -f%z "TexaCore-ERP-1.5.0-arm64.dmg")
printf 'version: 1.5.0\nfiles:\n  - url: TexaCore-ERP-1.5.0-arm64.dmg\n    sha512: %s\n    size: %s\npath: TexaCore-ERP-1.5.0-arm64.dmg\nsha512: %s\nreleaseDate: '\''%s'\''\n' "$SHA" "$SIZE" "$SHA" "$TS" > latest-mac.yml
cp "TexaCore ERP-1.5.0-arm64.dmg" "$HOME/Desktop/TexaCore ERP-1.5.0-arm64.dmg"
xattr -cr "$HOME/Desktop/TexaCore ERP-1.5.0-arm64.dmg" 2>/dev/null || true
echo "  ✓ dmg ready: $(stat -f%z 'TexaCore-ERP-1.5.0-arm64.dmg') bytes | on Desktop"
echo "═══ DONE v1.5.0 ═══"
