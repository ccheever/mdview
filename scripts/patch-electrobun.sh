#!/bin/bash
set -euo pipefail

# Patch and rebuild Electrobun with mdview's patches.
#
# Usage:
#   ./scripts/patch-electrobun.sh          # apply patches + rebuild
#   ./scripts/patch-electrobun.sh --check   # dry-run: see if patches apply cleanly
#   ./scripts/patch-electrobun.sh --revert  # undo patches (git checkout)

MDVIEW_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PATCHES_DIR="$MDVIEW_DIR/patches/electrobun"
ELECTROBUN_DIR="${ELECTROBUN_DIR:-$(cd "$MDVIEW_DIR/../electrobun" && pwd)}"
ELECTROBUN_PKG="$ELECTROBUN_DIR/package"

if [ ! -d "$ELECTROBUN_PKG" ]; then
    echo "Error: Electrobun not found at $ELECTROBUN_PKG"
    echo "Set ELECTROBUN_DIR to your electrobun checkout."
    exit 1
fi

MODE="${1:---apply}"

case "$MODE" in
    --check)
        echo "Checking if patches apply cleanly to $ELECTROBUN_PKG..."
        for patch in "$PATCHES_DIR"/*.patch; do
            name="$(basename "$patch")"
            if git -C "$ELECTROBUN_DIR" apply --check "$patch" 2>/dev/null; then
                echo "  $name — OK"
            else
                echo "  $name — CONFLICT (may already be applied or needs updating)"
            fi
        done
        ;;
    --revert)
        echo "Reverting patches in $ELECTROBUN_PKG..."
        git -C "$ELECTROBUN_DIR" checkout -- package/
        echo "Done. Electrobun source is back to upstream."
        ;;
    --apply|*)
        echo "Applying patches to $ELECTROBUN_PKG..."
        for patch in "$PATCHES_DIR"/*.patch; do
            name="$(basename "$patch")"
            if git -C "$ELECTROBUN_DIR" apply --check "$patch" 2>/dev/null; then
                git -C "$ELECTROBUN_DIR" apply "$patch"
                echo "  Applied: $name"
            else
                echo "  Skipped: $name (already applied or conflicts — check manually)"
            fi
        done

        echo ""
        echo "Rebuilding Electrobun..."
        cd "$ELECTROBUN_PKG"
        bun build.ts
        echo ""
        echo "Done. Electrobun rebuilt with patches."
        ;;
esac
