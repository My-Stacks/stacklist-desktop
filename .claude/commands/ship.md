---
description: Release a new version — bumps version, verifies build, commits, tags, and pushes to trigger CI
---

# /ship — Release new version

Guides a full release: version bump → local build verification → git tag → push.
GitHub Actions handles the rest (signed DMG, GitHub Release, auto-updater delivery).

## Step 1 — Read current version

```bash
node -e "console.log(require('./package.json').version)"
```

Report it: "Current version is X.Y.Z"

## Step 2 — Determine new version

Ask: "Patch (bug fix), minor (new feature), or major (breaking)? Or enter a specific version."

Apply semver:
- patch: X.Y.Z → X.Y.(Z+1)
- minor: X.Y.Z → X.(Y+1).0
- major: X.Y.Z → (X+1).0.0

## Step 3 — Bump version in package.json

Edit `package.json` — change the `"version"` field to the new version. Nothing else.

## Step 4 — Verify the build

```bash
npm run build:mac
```

If it fails: show the error, revert `package.json`, stop.
If it succeeds: continue.

## Step 5 — Confirm before pushing

Show the user:
```
Ready to release:
  Version: X.Y.Z → A.B.C
  Commit:  chore: release vA.B.C
  Tag:     vA.B.C
  Push:    origin HEAD + origin vA.B.C

GitHub Actions will build the signed DMG and publish to GitHub Releases.
Running instances will be notified on next launch (once signing cert is in place).

Proceed? (yes / no)
```

Wait for explicit confirmation.

## Step 6 — Commit, tag, push

```bash
git add package.json
git commit -m "chore: release vA.B.C"
git tag vA.B.C
git push origin HEAD
git push origin vA.B.C
```

## Step 7 — Report

```
✅ Released vA.B.C
Tag pushed → GitHub Actions is building the DMG now.
Check progress: https://github.com/My-Stacks/stacklist-desktop/actions

Users on a previously installed version will be prompted to update on next app launch
(requires Developer ID Application cert to be active for auto-update to work).
```

## Constraints

- Never push without explicit user confirmation in Step 5
- Never skip the build verification step — a broken build should not be tagged
- Never amend a published tag
- Target branch: `main` only; warn if on any other branch
