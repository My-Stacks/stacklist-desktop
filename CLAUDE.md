# CLAUDE.md — stacklist-desktop

Electron shell that loads `https://stacklist.com/login`. No bundled server — all business logic lives on Vercel. Every web deploy is reflected instantly without a desktop release.

## Project structure

```
stacklist-desktop/
  src/
    main.js        # Electron main process: window, menu, auto-updater
    preload.js     # contextBridge — exposes { isElectron, platform, getVersion }
  build/
    icon.icns      # macOS app icon
    icon.ico       # Windows app icon
    icon.png       # 512×512 source (used for dev dock icon)
    entitlements.mac.plist
  scripts/
    rename-dev-electron.sh  # Patches node_modules/electron so dock shows "Stacklist Dev"
  electron-builder.yml
  package.json
```

## Common commands

```bash
npm start            # Dev: opens Electron at localhost:3000 (run platform-v2 dev server first)
npm run build:mac    # Produces dist/Stacklist-X.Y.Z-arm64.dmg (local, unsigned notarization skipped)
npm run build:win    # Windows NSIS installer
npm run publish      # Build + publish to GitHub Releases (used by CI only)
```

## Claude commands

| Command | When to use |
|---------|-------------|
| `/plan` | A web change landed — check if the desktop shell needs updating |
| `/ship` | Release a new version: bumps version, verifies build, tags, pushes |
| `/version-bump` | Change version string only (no tag, no push) |
| `/quality` | Quick sanity build before committing |

## Release flow

1. `/ship` → bumps `package.json` version, commits, pushes tag `vX.Y.Z`
2. GitHub Actions (`release.yml`) triggers → builds signed DMG + zip for macOS, NSIS for Windows
3. Artifacts published to GitHub Releases
4. Running instances of the app pick up the update on next launch via `electron-updater`

**Users never need to re-download the DMG** — `electron-updater` delivers updates in-app automatically.

## Auto-update status

`electron-updater` is configured and will check GitHub Releases (`My-Stacks/stacklist-desktop`) on launch.

⚠️ **Currently blocked on signing**: auto-update requires a **Developer ID Application** certificate (Account Holder role on Apple Developer). The current cert is "Apple Development" only (Admin role). Once the Account Holder provides the cert:
1. Export as `.p12`, base64-encode, save as `CSC_LINK` GitHub secret
2. Save the password as `CSC_KEY_PASSWORD`
3. Re-run the release workflow — the new DMG will be signed, notarized, and auto-updates will work

Until then, the web app itself updates instantly (it's just a URL), so no desktop release is needed for web-only changes.

## Key implementation notes

- **Production URL**: `https://stacklist.com/login` — loads the app login directly, bypassing the marketing homepage redirect
- **Dev dock name**: `scripts/rename-dev-electron.sh` patches `node_modules/electron/dist/` on `postinstall` so the dock shows "Stacklist Dev" instead of "Electron"
- **User agent**: Electron token stripped — server sees plain Chrome UA
- **OAuth popups**: Firebase opens `firebaseapp.com` first. The `setWindowOpenHandler` allowlist includes `firebaseapp.com`, `google.com`, `googleapis.com`, `stacklist.com`, and `localhost`
- **External links**: anything outside `stacklist.com` / `stacklist.app` opens in the system browser

## Environment / secrets (GitHub Actions)

| Secret | Purpose |
|--------|---------|
| `CSC_LINK` | Base64-encoded `.p12` Developer ID Application cert |
| `CSC_KEY_PASSWORD` | Password for that cert |
| `APPLE_ID` | Apple ID email for notarization |
| `APPLE_TEAM_ID` | 10-char Apple team ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization |
| `GH_TOKEN` | GitHub token with `contents: write` (auto-provided by Actions) |
