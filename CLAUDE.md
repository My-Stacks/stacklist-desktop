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
| `/build-tag` | **Preferred release path.** Bumps `package.json` on a `chore/release-vX.Y.Z` branch and opens a PR. Merging that PR is what releases (see below). |
| `/sync-downloads` | Manual fallback: point `stacklist-website` download links at the latest release + open a PR (use if the CI auto-PR didn't fire) |
| `/version-bump` | Change version string only (no commit, no PR) |
| `/quality` | Quick sanity build before committing |

> Releases are **merge-driven**: the version lives in `package.json`, and merging a version bump to `main` is the single act that cuts the release. There is no manual `git tag` — electron-builder creates the `vX.Y.Z` GitHub Release (and its tag) on publish.

## Release flow (release-on-merge)

1. Bump `version` in `package.json` — either in your feature PR, or via `/build-tag` which opens a dedicated bump PR
2. The **`version-check`** workflow comments on the PR: "will release vX.Y.Z" / "no bump → no release" / ❌ fails if that version is already published
3. **Merge to `main`** → `release.yml` runs:
   - `check` job: if `vX.Y.Z` is already released → skip (this push didn't bump). Otherwise →
   - `build-mac` + `build-win` → `npm run publish` → electron-builder publishes the signed DMG/zip + NSIS installer to GitHub Releases (creating the `vX.Y.Z` release + tag)
   - `sync-website` → bumps `DESKTOP_VERSION` in `stacklist-website`, opens a PR against `main`, posts to Slack
4. **Review & merge the website PR** → `stacklist.com/apps` download links now point at the new version
5. Running instances of the app pick up the update on next launch via `electron-updater`

Pushes to `main` that **don't** bump the version (docs, CI, refactors) are detected by the `check` job as already-released and **skip the build entirely** — no wasted release.

**Users never need to re-download the DMG** — `electron-updater` delivers updates in-app automatically.

### Signed test build (before a bump)

A signed build can only come from CI: no local Mac holds the Developer ID certificate. To test a change on a signed build without releasing it (for example push notifications, which need a signed app):

```bash
gh workflow run release.yml --repo My-Stacks/stacklist-desktop --ref <branch> -f test_build=true
```

It builds, signs and notarizes the Mac DMG and zip and builds the Windows installer with `--publish=never`, then attaches them to the run as the `Stacklist-mac` and `Stacklist-win` artifacts. It creates no release and no tag, leaves `latest-mac.yml` alone, and opens no website PR. A test build never publishes, even when `force` is also ticked. The files carry the current `package.json` version, so do not hand them to users.

### Website download links (single source of truth)

The `/apps` page download links live in `stacklist-website` (local clone: `../stacklist-hub`) at `src/config/apps.ts` — a single constant:

```ts
const DESKTOP_VERSION = 'v1.0.22';
```

That one value drives **both** the Mac/Windows download hrefs and their visible sublabels. The `sync-website` CI job bumps it automatically after each release publishes; `/sync-downloads` does the same by hand. Asset URLs are derived as `Stacklist-<ver>-arm64.dmg` and `Stacklist-Setup-<ver>.exe`.

The `sync-website` job runs only when a release was actually cut, **skips cleanly** if `WEBSITE_REPO_TOKEN` is unset, is **idempotent** (no-ops when already in sync, reuses an open PR), and **never auto-merges** — links only flip after the PR is approved.

## Auto-update status

`electron-updater` checks GitHub Releases (`My-Stacks/stacklist-desktop`) on launch and asks before downloading.

Signing works. Releases since v1.0.23 are signed with the **Developer ID Application: Stacks, Incorporated (66H9U7SPZQ)** certificate and notarized in CI (`CSC_LINK`, `CSC_KEY_PASSWORD` and the `APPLE_*` secrets below), so Gatekeeper accepts them and in-app updates install.

**macOS minimum is 13 (Ventura)** from the Electron 45 upgrade on (Electron 44+ dropped macOS 12). It is enforced twice:
- `mac.minimumSystemVersion: '13.0'` in `electron-builder.yml` sets `LSMinimumSystemVersion`, so a fresh install on macOS 12 or older is refused.
- `release.yml` re-uploads `latest-mac.yml` with `minimumSystemVersion: 22.0.0` after publishing, so installed apps on macOS 11/12 are never offered the update. electron-updater compares it with `os.release()`, the Darwin kernel version (22 = macOS 13). electron-builder does not write this field itself; keep that step when editing the workflow.

The web app itself updates instantly (it's just a URL), so no desktop release is needed for web-only changes.

## Key implementation notes

- **Production URL**: `https://stacklist.com/login` — loads the app login directly, bypassing the marketing homepage redirect
- **Dev dock name**: `scripts/rename-dev-electron.sh` runs as `prestart`: it downloads the Electron binary if missing (Electron 42+ no longer downloads it on `npm install`), then patches `node_modules/electron/dist/` so the dock shows "Stacklist Dev" instead of "Electron"
- **macOS notifications need a signed app** (Electron 42+ uses `UNNotification`): `npm start` and local unsigned builds emit `failed` instead of showing; test push notifications only on a Developer ID signed build
- **Clipboard is async** (Electron 44+): `clipboard.writeText` returns a Promise, so await or `.catch` it
- **User agent**: Electron token stripped — server sees plain Chrome UA
- **OAuth popups**: the web app's Firebase `authDomain` is `auth.stacklist.com`, so Google sign-in opens `https://auth.stacklist.com/__/auth/handler`. `setWindowOpenHandler` opens any app-host URL under `/__/auth/`, plus `firebaseapp.com`, `google.com` and `googleapis.com`, as a child popup **before** the app-host rule that keeps our own pages in the main window. Loaded in the main window, the handler loses its opener and sign-in never finishes
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
