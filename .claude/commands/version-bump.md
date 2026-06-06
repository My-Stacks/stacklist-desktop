---
description: Change the version string in package.json without tagging or pushing
---

# /version-bump — Change version only

Updates the version in `package.json`. Does not commit, tag, or push.
Use this to set up the version for manual release, or to correct a version before running `/ship`.

## Steps

1. Read current version:
   ```bash
   node -e "console.log(require('./package.json').version)"
   ```

2. Ask: "New version? (e.g. 1.1.0)"

3. Edit `package.json` — change `"version"` to the new value only.

4. Report:
   ```
   ✅ Version bumped: X.Y.Z → A.B.C in package.json
   Not committed. Run /ship when ready to build and release.
   ```

## Constraints

- Only touch the `"version"` field in `package.json`
- Do not commit or push
