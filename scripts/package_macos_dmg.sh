#!/usr/bin/env bash
# Packages a Flutter macOS Release .app bundle into a clean drag-to-Applications .dmg
# Usage: package_macos_dmg.sh <app_display_name> [project_dir] [output_dir]
set -euo pipefail

APP_DISPLAY_NAME="${1:?App display name required}"
PROJECT_DIR="${2:-.}"
OUTPUT_DIR="${3:-dist}"

cd "$PROJECT_DIR"
RELEASE_DIR="build/macos/Build/Products/Release"

APP_BUNDLE="$(find "$RELEASE_DIR" -maxdepth 1 -name "*.app" | head -n 1)"
if [[ -z "$APP_BUNDLE" || ! -d "$APP_BUNDLE" ]]; then
  echo "Error: No .app bundle found in $RELEASE_DIR" >&2
  exit 1
fi

# Ensure ad-hoc signature is intact if no Developer ID certificate was used,
# preventing Apple Silicon Gatekeeper "App is damaged" errors on unsigned builds.
if [[ -z "${MACOS_DEVELOPER_ID_IDENTITY:-}" ]]; then
  codesign --force --deep --sign - "$APP_BUNDLE"
else
  codesign --force --deep --options runtime --sign "$MACOS_DEVELOPER_ID_IDENTITY" "$APP_BUNDLE"
fi

mkdir -p "$OUTPUT_DIR"
SAFE_NAME="${APP_DISPLAY_NAME// /-}"
DMG_PATH="$OUTPUT_DIR/${SAFE_NAME}-macOS.dmg"
rm -f "$DMG_PATH"

STAGING_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGING_DIR"' EXIT

cp -R "$APP_BUNDLE" "$STAGING_DIR/"
ln -s /Applications "$STAGING_DIR/Applications"

hdiutil create \
  -volname "$APP_DISPLAY_NAME" \
  -srcfolder "$STAGING_DIR" \
  -ov \
  -format UDZO \
  "$DMG_PATH"

echo "Created macOS installer: $DMG_PATH"
