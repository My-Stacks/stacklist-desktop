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
| `/build-tag` | **Preferred release path.** Reads the latest *remote* tag, bumps, tags, pushes — CI builds, publishes, and auto-opens the website download-links PR |
| `/sync-downloads` | Manual fallback: point `stacklist-website` download links at the latest release + open a PR (use if the CI auto-PR didn't fire) |
| `/ship` | Older release path: bumps version, verifies build locally, tags, pushes (does *not* trigger the website sync any differently — sync is CI-side) |
| `/version-bump` | Change version string only (no tag, no push) |
| `/quality` | Quick sanity build before committing |

> `/build-tag` reads the latest **remote** tag (not local `package.json`), so a stale local clone can't recreate an existing version. `/ship` bumps off local `package.json` — pull `main` first if you use it.

## Release flow

1. `/build-tag` → bumps `package.json` version, commits, pushes tag `vX.Y.Z`
2. GitHub Actions (`release.yml`) triggers → `build-mac` + `build-win` build signed DMG + zip for macOS, NSIS for Windows
3. Artifacts published to GitHub Releases
4. `sync-website` job (after both builds) → bumps `DESKTOP_VERSION` in `stacklist-website`, opens a PR against `main`, posts to Slack
5. **Review & merge that PR** → `stacklist.com/apps` download links now point at the new version
6. Running instances of the app pick up the update on next launch via `electron-updater`

**Users never need to re-download the DMG** — `electron-updater` delivers updates in-app automatically.

### Website download links (single source of truth)

The `/apps` page download links live in `stacklist-website` (local clone: `../stacklist-hub`) at `src/config/apps.ts` — a single constant:

```ts
const DESKTOP_VERSION = 'v1.0.22';
```

That one value drives **both** the Mac/Windows download hrefs and their visible sublabels. The `sync-website` CI job (step 4 above) bumps it automatically on each release; `/sync-downloads` does the same by hand. Asset URLs are derived as `Stacklist-<ver>-arm64.dmg` and `Stacklist-Setup-<ver>.exe`.

The `sync-website` job is **tag-push only**, **skips cleanly** if `WEBSITE_REPO_TOKEN` is unset, is **idempotent** (no-ops when already in sync, reuses an open PR), and **never auto-merges** — links only flip after the PR is approved.

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
| `WEBSITE_REPO_TOKEN` | Fine-grained PAT with `contents:write` + `pull-requests:write` on `My-Stacks/stacklist-website` — lets the `sync-website` job open the download-links PR (the built-in `GITHUB_TOKEN` can't write to another repo) |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook — `sync-website` posts the "downloads PR opened" notification |
