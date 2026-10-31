#!/usr/bin/env bash
# Packages a Flutter Linux x64 release bundle into both a portable .AppImage and .tar.gz
# Usage: package_linux_appimage.sh <app_slug> <app_display_name> [project_dir] [output_dir]
set -euo pipefail

APP_SLUG="${1:?App slug required}"
APP_DISPLAY_NAME="${2:?App display name required}"
PROJECT_DIR="${3:-.}"
OUTPUT_DIR="${4:-dist}"

cd "$PROJECT_DIR"
BUNDLE_DIR="build/linux/x64/release/bundle"

if [[ ! -d "$BUNDLE_DIR" ]]; then
  echo "Error: Linux release bundle not found at $BUNDLE_DIR" >&2
  exit 1
fi

# Detect binary inside bundle/ (executable regular file at top level of bundle/)
BIN_PATH="$(find "$BUNDLE_DIR" -maxdepth 1 -type f -executable | head -n 1)"
if [[ -z "$BIN_PATH" ]]; then
  echo "Error: Could not find executable inside $BUNDLE_DIR" >&2
  exit 1
fi
BIN_NAME="$(basename "$BIN_PATH")"

mkdir -p "$OUTPUT_DIR"
SAFE_NAME="${APP_DISPLAY_NAME// /-}"

# 1. Create universal .tar.gz archive
TAR_PATH="$OUTPUT_DIR/${SAFE_NAME}-Linux-x64.tar.gz"
tar -czf "$TAR_PATH" -C "$BUNDLE_DIR" .
echo "Created Linux archive: $TAR_PATH"

# 2. Build portable .AppImage
APPDIR="$(mktemp -d)/${SAFE_NAME}.AppDir"
mkdir -p "$APPDIR/usr/bin"
cp -R "$BUNDLE_DIR"/* "$APPDIR/usr/bin/"

cat > "$APPDIR/AppRun" <<EOF
#!/bin/sh
SELF=\$(readlink -f "\$0")
HERE=\${SELF%/*}
export LD_LIBRARY_PATH="\${HERE}/usr/bin/lib:\${LD_LIBRARY_PATH:-}"
exec "\${HERE}/usr/bin/${BIN_NAME}" "\$@"
EOF
chmod +x "$APPDIR/AppRun"

cat > "$APPDIR/${APP_SLUG}.desktop" <<EOF
[Desktop Entry]
Name=${APP_DISPLAY_NAME}
Exec=${BIN_NAME}
Icon=${APP_SLUG}
Type=Application
Categories=Utility;Network;AudioVideo;
Terminal=false
EOF

if [[ -f "assets/appIcon.png" ]]; then
  cp "assets/appIcon.png" "$APPDIR/${APP_SLUG}.png"
elif [[ -f "web/icons/Icon-512.png" ]]; then
  cp "web/icons/Icon-512.png" "$APPDIR/${APP_SLUG}.png"
else
  # Minimal valid 1x1 transparent PNG fallback
  printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82' > "$APPDIR/${APP_SLUG}.png"
fi

APPIMAGETOOL="/tmp/appimagetool-x86_64.AppImage"
if [[ ! -x "$APPIMAGETOOL" ]]; then
  curl -fsSL -o "$APPIMAGETOOL" \
    "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage"
  chmod +x "$APPIMAGETOOL"
fi

APPIMAGE_PATH="$OUTPUT_DIR/${SAFE_NAME}-Linux-x86_64.AppImage"
ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 "$APPIMAGETOOL" "$APPDIR" "$APPIMAGE_PATH"
chmod +x "$APPIMAGE_PATH"
echo "Created Linux AppImage: $APPIMAGE_PATH"
