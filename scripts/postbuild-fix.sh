#!/bin/bash
# ════════════════════════════════════════════════════════
# 🔧 Post-Build Fix: Copy missing transitive dependencies
# electron-builder sometimes fails to hoist shared deps
# Run after: npm run build:win / npm run build:mac
# ════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

echo "🔧 Fixing missing transitive dependencies..."

# List of modules that electron-builder sometimes fails to hoist
MISSING_MODULES=(
  call-bind-apply-helpers
  side-channel-list
  side-channel-weakmap
)

fix_platform() {
  local DEST="$1"
  if [ ! -d "$DEST" ]; then return; fi

  local FIXED=0
  for mod in "${MISSING_MODULES[@]}"; do
    if [ -d "node_modules/$mod" ] && [ ! -d "$DEST/$mod" ]; then
      cp -r "node_modules/$mod" "$DEST/$mod"
      echo "  ✅ Copied: $mod → $(basename $(dirname $DEST))"
      FIXED=$((FIXED + 1))
    fi
  done

  if [ $FIXED -eq 0 ]; then
    echo "  ✓ All modules already present in $(basename $(dirname $DEST))"
  fi
}

# Windows
echo "── Windows ──"
fix_platform "dist/win-unpacked/resources/app/node_modules"

# Mac
echo "── macOS ──"
fix_platform "dist/mac-arm64/TexaCore ERP.app/Contents/Resources/app/node_modules"

echo ""
echo "✅ Post-build fix complete!"
echo ""
echo "If Windows was fixed, repackage the installer:"
echo "  npx electron-builder --win --prepackaged dist/win-unpacked"
