---
description: Check whether a web platform change requires an update to the Electron shell
---

# /plan — Desktop impact check

You are assessing whether a recent change in the Stacklist web platform (`stacklist-platform-v2`) requires any change to the Electron desktop shell (`stacklist-desktop`).

The desktop is a thin shell. Most web changes need **zero desktop action** — they are reflected instantly because the shell just loads a URL. This command's job is to make that determination quickly and explicitly.

## Step 1 — Understand the web change

Ask the user: "What web change should I check? (PR number, commit hash, branch name, file path, or just describe it.)"

Then read the relevant web code. Paths are relative to `/Users/martinabicanic/Documents/workspace/stacklist/stacklist-platform-v2/`.

If they give a PR or commit, run:
```bash
cd /Users/martinabicanic/Documents/workspace/stacklist/stacklist-platform-v2 && git log --oneline -10
git diff HEAD~1 --name-only
```

## Step 2 — Read the current shell config

Read `src/main.js` in `stacklist-desktop`. Pay attention to:
- `startURL` (line ~58) — the URL loaded on launch
- `setWindowOpenHandler` allowlist (the `isAllowedPopup` block)
- `will-navigate` hostname check
- `webPreferences` object

## Step 3 — Evaluate impact

Check whether the web change involves any of these **trigger categories**:

| Category | What to look for | Desktop action if yes |
|----------|------------------|-----------------------|
| New external domain | New URL in fetch/redirect/OAuth/embed | Add to `isAllowedPopup` or `will-navigate` allowlist in `main.js` |
| New OAuth / SSO provider | New `signInWithPopup`, `signInWithRedirect`, new auth domain | Add auth domain to `isAllowedPopup` allowlist |
| Load URL change | `/login` renamed, new entry path | Update `startURL` in `main.js` |
| New popup window | `window.open()` to new domain | Add domain to `setWindowOpenHandler` allowlist |
| CSP / security change | `Content-Security-Policy`, `X-Frame-Options` | May need `webPreferences` adjustment |
| Service worker / push domain | New Pusher, Firebase, or push endpoint domain | Verify Electron's Chromium can reach it (usually fine) |
| Deep link route | New `stacklist://` path users might navigate to | Usually no action — Electron opens the URL in the window |

## Step 4 — Output

Print a table:

```
| Area checked             | Status            | Notes |
|--------------------------|-------------------|-------|
| External domains         | ✅ No change       |       |
| OAuth flows              | ⚠️ Action needed  | New provider X uses domain Y — add to allowlist |
| Load URL                 | ✅ No change       |       |
| Popup handling           | ✅ No change       |       |
| CSP / webPreferences     | ✅ No change       |       |
| Push / service worker    | ✅ No change       |       |
```

If **any row shows "Action needed"**: show the exact edit to `src/main.js` (old string → new string), then stop and wait for approval before making any change.

If **all rows are "No change"**: say so clearly — no desktop release needed for this web change.

## Constraints

- Read-only until Step 4 proposes an edit and the user approves
- Do not suggest a new desktop release unless `src/main.js` actually needs to change
- Do not read files outside `stacklist-desktop/src/main.js` and the web platform path the user points you at
