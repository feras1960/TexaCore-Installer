#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Phase 1 build — v1.4.3 (hexagon icon + header logo + tray + window fix)
# Run from texacore-installer/ :  bash scripts/phase1-build.sh
# ═══════════════════════════════════════════════════════════════
set -e
ROOT="/Users/macbook/TexaCore-Backups-2026-03-25/erpsystem supabase"
INST="$ROOT/texacore-installer"
cd "$INST"

echo "═══ 1) render icon + tray from SVG (transparent) ═══"
qlmanage -t -s 1024 -o /tmp build/brand/texacore-hexagon-icon.svg >/dev/null 2>&1
mv -f /tmp/texacore-hexagon-icon.svg.png /tmp/ic1024.png
qlmanage -t -s 128 -o /tmp build/brand/tray-template.svg >/dev/null 2>&1
mv -f /tmp/tray-template.svg.png /tmp/tray128.png
echo "  app icon alpha=$(sips -g hasAlpha /tmp/ic1024.png | grep hasAlpha | awk '{print $2}')"

echo "═══ 2) iconset → icon.icns + icon.png ═══"
ICONSET=/tmp/texacore.iconset
rm -rf "$ICONSET"; mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s        /tmp/ic1024.png --out "$ICONSET/icon_${s}x${s}.png"     >/dev/null
  d=$((s*2)); sips -z $d $d /tmp/ic1024.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o build/icon.icns
cp -f /tmp/ic1024.png build/icon.png
echo "  ✓ build/icon.icns + build/icon.png"

echo "═══ 3) tray template (16 + 32, black+alpha) ═══"
sips -z 16 16 /tmp/tray128.png --out build/trayTemplate.png    >/dev/null
sips -z 32 32 /tmp/tray128.png --out build/trayTemplate@2x.png >/dev/null
echo "  ✓ trayTemplate.png + @2x"

echo "═══ 4) bump version → 1.4.3 ═══"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
/usr/bin/sed -i '' 's/"version": "1.4.2"/"version": "1.4.3"/' package.json
/usr/bin/sed -i '' "s#\"buildDate\": \".*\"#\"buildDate\": \"$TS\"#" package.json
/usr/bin/sed -i '' 's/"version": "1.4.2"/"version": "1.4.3"/' "$ROOT/package.json"
echo "  installer=$(grep '\"version\"' package.json | head -1) | erp=$(grep '\"version\"' "$ROOT/package.json" | head -1)"

echo "═══ 5) build frontend + embed ═══"
( cd "$ROOT" && npm run build:installer 2>&1 | tail -2 )

echo "═══ 6) build mac (.app) ═══"
rm -rf dist/mac-arm64 dist/*.dmg dist/*.dmg.blockmap 2>/dev/null || true
npm run build:mac 2>&1 | tail -4 || true   # electron-builder dmg step may transiently fail; we rebuild dmg ourselves

echo "═══ 7) ad-hoc sign + rebuild dmg ═══"
APP="dist/mac-arm64/TexaCore ERP.app"
codesign --force --deep --sign - "$APP"
codesign --verify --deep "$APP" && echo "  ✓ signed"
cd dist
rm -rf dmg-stage "TexaCore ERP-1.4.3-arm64.dmg" "TexaCore-ERP-1.4.3-arm64.dmg"
mkdir -p dmg-stage
ditto "mac-arm64/TexaCore ERP.app" "dmg-stage/TexaCore ERP.app"
ln -s /Applications "dmg-stage/Applications"
hdiutil create -volname "TexaCore ERP" -srcfolder dmg-stage -ov -format UDZO "TexaCore ERP-1.4.3-arm64.dmg" >/dev/null
rm -rf dmg-stage
cp "TexaCore ERP-1.4.3-arm64.dmg" "TexaCore-ERP-1.4.3-arm64.dmg"
SHA=$(openssl dgst -sha512 -binary "TexaCore-ERP-1.4.3-arm64.dmg" | openssl base64 -A)
SIZE=$(stat -f%z "TexaCore-ERP-1.4.3-arm64.dmg")
printf 'version: 1.4.3\nfiles:\n  - url: TexaCore-ERP-1.4.3-arm64.dmg\n    sha512: %s\n    size: %s\npath: TexaCore-ERP-1.4.3-arm64.dmg\nsha512: %s\nreleaseDate: '\''%s'\''\n' "$SHA" "$SIZE" "$SHA" "$TS" > latest-mac.yml
cp "TexaCore ERP-1.4.3-arm64.dmg" "$HOME/Desktop/TexaCore ERP-1.4.3-arm64.dmg"
xattr -cr "$HOME/Desktop/TexaCore ERP-1.4.3-arm64.dmg" 2>/dev/null || true
echo "  ✓ dmg ready: $(ls -la 'TexaCore-ERP-1.4.3-arm64.dmg' | awk '{print $5}') bytes | on Desktop too"
echo "═══ DONE — next: quit running app, replace /Applications, relaunch, then gh release ═══"
