#!/bin/sh
# Patches the local Electron.app bundle so the dock shows "Stacklist Dev"
# instead of "Electron" during development. Runs automatically before
# `npm start` (prestart).
#
# Since Electron 42 the `electron` package no longer downloads its binary in
# postinstall; it downloads on first run instead. So this script fetches the
# binary first (Electron's own install-electron step), then renames it.
set -e

# The bundle rename and PlistBuddy are macOS-only.
[ "$(uname -s)" = "Darwin" ] || exit 0

DIST="node_modules/electron/dist"

if [ ! -d "$DIST/Electron.app" ] && [ ! -d "$DIST/Stacklist Dev.app" ]; then
  node node_modules/electron/install.js
fi

# Rename the bundle directory if it's still called Electron.app
if [ -d "$DIST/Electron.app" ]; then
  rm -rf "$DIST/Stacklist Dev.app"
  mv "$DIST/Electron.app" "$DIST/Stacklist Dev.app"
fi

PLIST="$DIST/Stacklist Dev.app/Contents/Info.plist"

if [ ! -f "$PLIST" ]; then
  echo "scripts/rename-dev-electron.sh: bundle not found, skipping"
  exit 0
fi

/usr/libexec/PlistBuddy -c "Set :CFBundleName 'Stacklist Dev'"        "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName 'Stacklist Dev'" "$PLIST"

# Update the path.txt pointer used by the electron CLI
printf "Stacklist Dev.app/Contents/MacOS/Electron" > node_modules/electron/path.txt

echo "scripts/rename-dev-electron.sh: patched to Stacklist Dev ✓"
