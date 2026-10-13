#!/bin/bash
# ════════════════════════════════════════════════════════════════
# prepare-pg-mac.sh — PostgreSQL 17.6 for macOS arm64, relocatable, thinned to arm64.
#
#   scripts/prepare-pg-mac.sh [SRC_DIR]
#
# SRC_DIR is the universal EDB build tree (bin/ lib/ share/) — default
# $PG17_SRC or ~/Desktop/TexaCore_Dev_Core.nosync/pg17-build. It is READ-ONLY here: everything is copied.
# Output: bin/macos-arm64/pg/{bin,lib,share}. (bin/ is committed, as 1.8 did with 15.17.)
#
# What it does, and why:
#   * lipo -thin arm64 every Mach-O (the source is x86_64+arm64 universal; we ship arm64 only).
#   * Drops the language packs that link outside the tree (plperl/plpython/pltcl and their transforms) —
#     they point at /Library/edb/languagepack/...; nothing in TexaCore uses them. Also drops contrib `xml2` (pgxml needs libxslt, not in the tree).
#   * Rewrites each bundled dylib's install name to @loader_path/<name> (they carry /Library/PostgreSQL/17/lib/...).
#     Dependents already use @loader_path/../lib/..., so after this nothing refers to an absolute path outside the system.
#   * Re-signs every Mach-O ad-hoc (install_name_tool / lipo invalidate the vendor signature; Apple Silicon kills unsigned code).
#   * Verifies: no dependency outside @loader_path / @rpath / /usr/lib / /System; versions; every extension in
#     share/postgresql/extension has its dylib (where it needs one).
# ════════════════════════════════════════════════════════════════
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-${PG17_SRC:-$HOME/Desktop/TexaCore_Dev_Core.nosync/pg17-build}}"
DEST="$HERE/bin/macos-arm64/pg"

[ -x "$SRC/bin/postgres" ] || { echo "!! $SRC/bin/postgres not found (set PG17_SRC)" >&2; exit 1; }
"$SRC/bin/postgres" --version | grep -q "PostgreSQL) 17\." || { echo "!! source is not PostgreSQL 17: $("$SRC/bin/postgres" --version)" >&2; exit 1; }

rm -rf "$DEST"
mkdir -p "$DEST/bin" "$DEST/lib/postgresql" "$DEST/share"

thin() { # thin <src> <dst>
  if lipo -info "$1" 2>/dev/null | grep -q "Architectures in the fat file"; then
    lipo -thin arm64 "$1" -output "$2"
  else
    cp -p "$1" "$2"
  fi
  chmod u+w "$2"
}

# ── executables ──
for b in initdb pg_ctl postgres psql pg_dump pg_dumpall pg_restore; do
  [ -f "$SRC/bin/$b" ] && thin "$SRC/bin/$b" "$DEST/bin/$b"
done

# ── shared libraries (real files first, then the symlink names) ──
for f in "$SRC"/lib/*.dylib; do
  if [ -L "$f" ]; then continue; fi
  thin "$f" "$DEST/lib/$(basename "$f")"
done
for f in "$SRC"/lib/*.dylib; do
  if [ -L "$f" ]; then ln -sf "$(readlink "$f")" "$DEST/lib/$(basename "$f")"; fi
done
# Symlinks that the EDB tree ships as hard copies would otherwise be duplicated; keep them as links where the name is an alias.
python3 - "$DEST/lib" <<'PY'
import os, sys, hashlib
d = sys.argv[1]
files = [f for f in os.listdir(d) if f.endswith('.dylib') and not os.path.islink(os.path.join(d, f))]
def h(p): return hashlib.sha256(open(p,'rb').read()).hexdigest()
by = {}
for f in sorted(files, key=lambda x: (-len(x), x)):   # longest (most specific) name first stays the real file
    by.setdefault(h(os.path.join(d, f)), []).append(f)
for digest, names in by.items():
    keep = names[0]
    for other in names[1:]:
        os.remove(os.path.join(d, other)); os.symlink(keep, os.path.join(d, other))
PY

# ── server extensions / encodings ($libdir = ../lib/postgresql relative to bin/) ──
for f in "$SRC"/lib/postgresql/*.dylib; do
  base="$(basename "$f")"
  case "$base" in
    plperl*|plpython3*|pltcl*|*_plperl*|*_plpython3*|*_pltcl*|bool_plperl*|hstore_plperl*|jsonb_plperl*|jsonb_plpython3*|hstore_plpython3*|ltree_plpython3*) continue ;;
    pgxml.dylib) continue ;;   # contrib `xml2` needs libxslt, which the EDB tree does not ship; nothing uses it
  esac
  thin "$f" "$DEST/lib/postgresql/$base"
done

# ── share ──
cp -R "$SRC/share/." "$DEST/share/"
# the language-pack control/sql files are useless without their dylibs
find "$DEST/share" \( -name 'xml2*' -o -name 'plperl*' -o -name 'plpython3*' -o -name 'pltcl*' -o -name '*_plperl*' -o -name '*_plpython3*' -o -name '*_pltcl*' -o -name 'bool_plperl*' -o -name 'ltree_plpython3*' \) -print -delete | sed 's/^/   dropped /' >/dev/null

# ── install names → @loader_path ──
for f in "$DEST"/lib/*.dylib; do
  [ -L "$f" ] && continue
  install_name_tool -id "@loader_path/$(basename "$f")" "$f" 2>/dev/null
done
for f in "$DEST"/lib/postgresql/*.dylib; do
  install_name_tool -id "@loader_path/$(basename "$f")" "$f" 2>/dev/null
done

# ── ad-hoc re-sign every Mach-O ──
find "$DEST" -type f \( -perm -u+x -o -name '*.dylib' \) | while read -r f; do
  if file "$f" | grep -q "Mach-O"; then codesign --force --sign - "$f" 2>/dev/null; fi
done

# ── verification ──
bad=0
while read -r f; do
  file "$f" | grep -q "Mach-O" || continue
  file "$f" | grep -q "arm64" || { echo "!! not arm64: $f"; bad=1; }
  while read -r dep; do
    case "$dep" in
      @loader_path/*|@rpath/*|@executable_path/*|/usr/lib/*|/System/*) ;;
      *) echo "!! non-relocatable dependency in $f: $dep"; bad=1 ;;
    esac
  done < <(otool -L "$f" | tail -n +2 | awk '{print $1}')
done < <(find "$DEST" -type f \( -perm -u+x -o -name '*.dylib' \))
[ $bad = 0 ] || { echo "!! relocatability check FAILED" >&2; exit 1; }

# every dylib a bundled binary asks for must exist beside it
missing=0
for f in "$DEST"/bin/* "$DEST"/lib/*.dylib "$DEST"/lib/postgresql/*.dylib; do
  [ -L "$f" ] && continue
  dir="$(dirname "$f")"
  while read -r dep; do
    case "$dep" in
      @loader_path/*) [ -e "$dir/${dep#@loader_path/}" ] || { echo "!! $f needs $dep (missing)"; missing=1; } ;;
    esac
  done < <(otool -L "$f" | tail -n +2 | awk '{print $1}')
done
[ $missing = 0 ] || { echo "!! missing bundled dylib" >&2; exit 1; }

echo "PostgreSQL: $("$DEST/bin/postgres" --version)"
echo "size: $(du -sh "$DEST" | cut -f1)  files: $(find "$DEST" -type f | wc -l | tr -d ' ')"
echo "OK → $DEST"
