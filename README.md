# Stacklist Desktop

Electron desktop wrapper for [https://stacklist.app](https://stacklist.app).

## Prerequisites

- Node.js 18+
- npm

## Dev Setup

```bash
npm install && npm start
```

## Build Commands

```bash
npm run build:mac    # macOS (.dmg + .zip)
npm run build:win    # Windows (.exe NSIS installer)
npm run build:linux  # Linux (.AppImage + .deb)
```

## Publish

```bash
npm run publish
```

Requires:
- `GH_TOKEN` env var with repo write access (for publishing to GitHub Releases)
- Apple credentials for macOS notarization (see Code Signing below)

## App Icons

Drop `icon.icns` and `icon.ico` into `build/`. Use a 512x512 minimum PNG source and generate platform icons with [electron-icon-maker](https://github.com/jaretburkett/electron-icon-maker) or a similar tool.

## Code Signing (macOS)

Set the following env vars before building:

```bash
CSC_LINK=<path-or-base64-encoded-p12>
CSC_KEY_PASSWORD=<p12-password>
```

Or configure notarization credentials directly in `electron-builder.yml` under the `notarize` section.

## Auto-Updater

Releases are published to GitHub Releases. Update the `owner` and `repo` fields in `electron-builder.yml` to match your GitHub repository.
