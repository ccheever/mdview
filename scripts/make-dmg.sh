#!/bin/bash
set -euo pipefail

# Create a DMG installer for mdview.
# Usage: ./scripts/make-dmg.sh

MDVIEW_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# Prefer release build; fall back to dev build
if [ -d "$MDVIEW_DIR/build/macos-arm64/mdview.app" ]; then
    APP_PATH="$MDVIEW_DIR/build/macos-arm64/mdview.app"
elif [ -d "$MDVIEW_DIR/build/dev-macos-arm64/mdview-dev.app" ]; then
    APP_PATH="$MDVIEW_DIR/build/dev-macos-arm64/mdview-dev.app"
else
    APP_PATH=""
fi
DMG_DIR="$MDVIEW_DIR/build/dmg"
DMG_NAME="mdview"
DMG_PATH="$MDVIEW_DIR/build/$DMG_NAME.dmg"
VOLUME_NAME="mdview"

if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
    echo "Error: No .app found in build/. Run 'bun run build' first."
    exit 1
fi

echo "Creating DMG..."

# Clean up any previous DMG build
rm -rf "$DMG_DIR" "$DMG_PATH"
mkdir -p "$DMG_DIR"

# Copy the app into the staging directory
cp -R "$APP_PATH" "$DMG_DIR/"

# Create a symlink to /Applications for drag-install
ln -s /Applications "$DMG_DIR/Applications"

# Create the DMG
hdiutil create -volname "$VOLUME_NAME" \
    -srcfolder "$DMG_DIR" \
    -ov -format UDZO \
    "$DMG_PATH"

# Clean up staging directory
rm -rf "$DMG_DIR"

echo ""
echo "DMG created: $DMG_PATH"
echo "Size: $(du -h "$DMG_PATH" | cut -f1)"
