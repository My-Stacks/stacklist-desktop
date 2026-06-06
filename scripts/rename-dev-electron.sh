#!/bin/sh
# Patches the local Electron.app bundle so the dock shows "Stacklist Dev"
# instead of "Electron" during development. Runs automatically via postinstall.
set -e

DIST="node_modules/electron/dist"

# Rename the bundle directory if it's still called Electron.app
if [ -d "$DIST/Electron.app" ]; then
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
