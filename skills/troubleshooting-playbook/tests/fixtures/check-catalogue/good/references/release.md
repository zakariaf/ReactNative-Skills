# Release

Release failures. Match the text you see in the Symptom column, or run `find-fix.mjs --text "<first error line>"`.

Status: **verified** = seen and fixed in a real run; **documented** = read in the tool's own source or docs; **open** = not settled, the fix is the current fallback. **needs a human** = a stop: send one message and wait, never work around it. Platform: blank = both. Skill = where the full procedure lives. Reviewed on 2026-10-17 against Expo SDK 57; re-verify the versions with `xcrun altool --version`.

<!-- Generated from assets/known-failures/release.json by scripts/check-catalogue.mjs --write. Edit the JSON, not this file. -->

## Contents

- Signing
- Upload

## Signing

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `release-keychain-locked` | errSecInternalComponent from codesign | The login keychain is locked | Stop: the developer unlocks the keychain | documented, needs a human | iOS | `ios-release-testflight` |

## Upload

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `release-version-code-used` | Version code 14 has already been used | The version code was reused | Build again with the next number | documented | Android | `android-release-play` |
| `release-store-slow` | Processing takes longer than an hour | The store is slow | Wait, then resume the processing step | open |  |  |
