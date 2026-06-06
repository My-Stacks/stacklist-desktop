---
description: Verify the build compiles cleanly before committing or releasing
---

# /quality — Build verification

Runs a local macOS build to confirm nothing is broken. Use before committing changes to `src/main.js`, `preload.js`, or `electron-builder.yml`.

## Steps

```bash
npm run build:mac
```

**Pass**: Report artifact location and size:
```
✅ Build passed
  dist/Stacklist-X.Y.Z-arm64.dmg  (~101 MB)
  dist/Stacklist-X.Y.Z-arm64-mac.zip
```

**Fail**: Show the full error output. Do not auto-fix — report what failed and stop.

## Constraints

- Read-only except for running the build command
- Do not edit any files as part of this command
- If the build fails due to a missing dependency, suggest `npm install` but do not run it automatically
