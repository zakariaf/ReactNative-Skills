# Build

Build failures. Match the text you see in the Symptom column, or run `find-fix.mjs --text "<first error line>"`.

Status: **verified** = seen and fixed in a real run; **documented** = read in the tool's own source or docs; **open** = not settled, the fix is the current fallback. **needs a human** = a stop: send one message and wait, never work around it. Platform: blank = both. Skill = where the full procedure lives. Reviewed on 2026-10-17 against Expo SDK 57; re-verify the versions with `npx expo config`.

<!-- Generated from assets/known-failures/build.json by scripts/check-catalogue.mjs --write. Edit the JSON, not this file. -->

## Contents

- Variants

## Variants

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `build-metro-cache-variant` | A production bundle still contains test-only code | Metro does not key its cache on EXPO_PUBLIC_* values | Key config.cacheVersion on the public values | verified |  | `app-variants-and-environment` |
| `build-variant-mismatch` | EXPO_PUBLIC_APP_VARIANT=x must equal APP_VARIANT=y | Only one variable was exported | Export both with the same value | verified (expo 57.x) |  | `app-variants-and-environment` |
