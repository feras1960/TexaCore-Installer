#!/bin/bash
# ════════════════════════════════════════════════════════════════
# 🚀 TexaCore Installer — Release Script
# Usage: ./release.sh [patch|minor|major] "Release notes in Arabic"
# Example: ./release.sh patch "إصلاح مشكلة اكتشاف Docker"
# Example: ./release.sh minor "إضافة نظام التحديثات التلقائية"
# Example: ./release.sh major "إعادة بناء كاملة للواجهة"
# ════════════════════════════════════════════════════════════════

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ─── Args ─────────────────────────────────────────────────────
BUMP_TYPE=${1:-patch}  # patch (1.0.0 → 1.0.1), minor (1.0.0 → 1.1.0), major (1.0.0 → 2.0.0)
RELEASE_NOTES=${2:-"تحسينات وإصلاحات عامة"}

# ─── Validate ─────────────────────────────────────────────────
if [[ ! "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo -e "${RED}❌ نوع الإصدار غير صحيح. استخدم: patch, minor, أو major${NC}"
  exit 1
fi

# ─── Get current version ──────────────────────────────────────
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "${CYAN}📦 الإصدار الحالي: v${CURRENT_VERSION}${NC}"

# ─── Bump version ─────────────────────────────────────────────
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
case $BUMP_TYPE in
  patch) PATCH=$((PATCH + 1)) ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
esac
NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
echo -e "${GREEN}🆕 الإصدار الجديد: v${NEW_VERSION}${NC}"

# ─── Update package.json ──────────────────────────────────────
node -e "
const pkg = require('./package.json');
pkg.version = '${NEW_VERSION}';
require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('✅ تم تحديث package.json');
"

# ─── Update CHANGELOG.md ──────────────────────────────────────
DATE=$(date +%Y-%m-%d)
CHANGELOG_ENTRY="## [v${NEW_VERSION}] — ${DATE}

### التغييرات:
- ${RELEASE_NOTES}

---
"

if [ -f "CHANGELOG.md" ]; then
  # Insert after header
  TEMP=$(mktemp)
  head -2 CHANGELOG.md > "$TEMP"
  echo "" >> "$TEMP"
  echo "$CHANGELOG_ENTRY" >> "$TEMP"
  tail -n +3 CHANGELOG.md >> "$TEMP"
  mv "$TEMP" CHANGELOG.md
else
  cat > CHANGELOG.md << EOF
# 📋 TexaCore ERP — سجل التغييرات (Changelog)

${CHANGELOG_ENTRY}
EOF
fi
echo -e "${GREEN}✅ تم تحديث CHANGELOG.md${NC}"

# ─── Build for all platforms ──────────────────────────────────
echo -e "${YELLOW}🔨 جاري بناء macOS...${NC}"
npm run build:mac 2>&1 | tail -3

echo -e "${YELLOW}🔨 جاري بناء Windows...${NC}"
npm run build:win 2>&1 | tail -3

echo -e "${GREEN}✅ البناء مكتمل!${NC}"

# ─── List built files ─────────────────────────────────────────
echo ""
echo -e "${CYAN}📁 الملفات المبنية:${NC}"
ls -lah dist/*.dmg dist/*.exe dist/*.yml 2>/dev/null | awk '{print "   " $NF " → " $5}'

# ─── Git tag ──────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}📌 إنشاء Git tag: v${NEW_VERSION}${NC}"
cd ..
git add texacore-installer/package.json texacore-installer/CHANGELOG.md
git commit -m "release: v${NEW_VERSION} — ${RELEASE_NOTES}" 2>/dev/null || true
git tag -a "v${NEW_VERSION}" -m "${RELEASE_NOTES}" 2>/dev/null || true
cd texacore-installer

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ الإصدار v${NEW_VERSION} جاهز!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${CYAN}الخطوات التالية:${NC}"
echo -e "  1. ادفع إلى GitHub:"
echo -e "     ${YELLOW}git push origin main --tags${NC}"
echo ""
echo -e "  2. أنشئ GitHub Release:"
echo -e "     ${YELLOW}gh release create v${NEW_VERSION} \\${NC}"
echo -e "     ${YELLOW}  dist/\"TexaCore ERP-${NEW_VERSION}-universal.dmg\" \\${NC}"
echo -e "     ${YELLOW}  dist/\"TexaCore ERP Setup ${NEW_VERSION}.exe\" \\${NC}"
echo -e "     ${YELLOW}  dist/latest-mac.yml \\${NC}"
echo -e "     ${YELLOW}  dist/latest.yml \\${NC}"
echo -e "     ${YELLOW}  --title \"v${NEW_VERSION}\" \\${NC}"
echo -e "     ${YELLOW}  --notes \"${RELEASE_NOTES}\"${NC}"
echo ""
echo -e "  أو استخدم الأمر المختصر:"
echo -e "     ${YELLOW}npm run publish${NC}"
