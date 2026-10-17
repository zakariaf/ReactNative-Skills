# Tags, versions and release commits

Tags mark what reached a store. They come only from the release step, after the store accepted an upload, with the build number the upload reported. This page says what they look like and what never happens to them.

## Contents

- The tags
- Versions and build numbers
- Release commits
- OTA updates
- Pushing
- What check-tags checks
- When multi-package

## The tags

| Tag | When | Example |
|---|---|---|
| `v<X.Y.Z>+<build>` | after every successful store upload, when both platforms share one build number | `v1.4.0+14` |
| `v<X.Y.Z>+ios.<build>` and `v<X.Y.Z>+android.<build>` | after every successful upload, when each platform counts its own builds (EAS remote versioning) | `v1.4.0+ios.14`, `v1.4.0+android.31` |
| `v<X.Y.Z>` | when the reviewer says "ship" for that version (the build sent for review) | `v1.4.0` |

- `X.Y.Z` is the app's version (`version` in `app.config.ts`: the iOS short version string and Android `versionName`). PATCH is fixes only, MINOR adds features, MAJOR is the developer's decision.
- `<build>` is the build number the upload reported: iOS `CFBundleVersion` (`ios.buildNumber`), Android `versionCode` (`android.versionCode`). It only goes up, across versions, and is never reused: App Store Connect refuses a build number already uploaded for that version, and Play refuses any `versionCode` it has seen.
- One app keeps one scheme: a shared number, or one counter per platform. Mixing the two makes the order rules meaningless.
- Every form passes `git check-ref-format`. Only apps are tagged; shared packages ship inside them.
- Never move, delete or reuse a tag. A bad build gets a new build number, never the old tag.
- **Tags are annotated:** `git tag -a v1.4.0+ios.14 -m "App Store build 14"` (the message names the store and the build). An annotated tag records when it was made (its tagger date), which `check-tags.mjs` uses to check that build numbers rise in upload order. A lightweight tag (plain `git tag <name>`) only carries its commit's date, so rebuilding an older commit would look like going backwards; the checker therefore orders by time only when every tag of the app and platform is annotated.
- A release tag without an upload tag for the same version is impossible in a correct history: a version ships only after an upload. The on-device check is a human check, listed in the report; the "ship" word never waits for it.

## Versions and build numbers

**EAS (default).** With `"cli": { "appVersionSource": "remote" }` in `eas.json` and `"autoIncrement": true` on the production build profile, EAS stores and increments `ios.buildNumber` and `android.versionCode` on its servers, one counter per platform, and ignores the values in `app.config.ts` (verified on 2026-10-10 against docs.expo.dev/build-reference/app-versions; re-verify there). Use the per-platform tag form: after `eas submit` succeeds, tag `vX.Y.Z+ios.<n>` or `vX.Y.Z+android.<n>` with the number the build reported (`eas build:list`, or the build page). No commit is needed, because the numbers live remotely.

**Local lane** (teams without EAS: `expo prebuild` + `xcodebuild` or `gradlew`, then Transporter or the Play API). The build number lives in `app.config.ts` (or a file it reads) and the release step bumps it before the archive. Use the per-platform form here too (ios-release-testflight and android-release-play tag `+ios.<n>` and `+android.<n>`); an app whose history already uses one shared `+<n>` for both platforms keeps that scheme rather than mixing the two.

**iOS (App Store Connect):** a new build's version (`CFBundleShortVersionString`) must be higher than the last version approved for sale, so it must be higher than the app's last release tag `vX.Y.Z` (upload tags contain `+` and do not count). **Android (Google Play)** does not constrain `versionName`; only `versionCode` must increase. This library still keeps the version rising on both platforms, so one tag history describes both apps.

## Release commits

- On the local lane, the release step commits the bump before the archive as `chore(release): build <n>` (the only change is the build number), then tags after the upload succeeds. The commit follows every rule of `commit-format.md`; its body says which store and track it is for.
- With EAS remote versioning there is no release commit; the tag points at the commit that was built.
- A version bump for a new release is its own commit: `chore(release): start version 1.5.0`.
- Uploading, tagging for release, submitting for review and pushing are outward-facing: they need the developer's word in this session (`stop-and-ask.md`). "Submit" happens only after the developer says "submit".

## OTA updates

An update published with `eas update` (ota-updates) changes what users run without a store upload. Publishing to a production channel is outward-facing and needs the developer's word. It gets no store tag: the update group id and the runtime version go into the report's Details, and the commit that was published is named on the Evidence line.

## Pushing

Until the developer says the session may push, pushing is outward-facing: ask first. When a push happens, the pre-push hook runs; never skip it (`--no-verify` is denied). Push tags explicitly by name (`git push origin v1.4.0+14`), never `--tags` (which also pushes stray local tags).

## What check-tags checks

`scripts/check-tags.mjs` reads the repo's tags with their tagger dates (`git for-each-ref refs/tags --format='%(refname:strip=2) %(taggerdate:unix)'`; a lightweight tag has no tagger date and prints none), or a list (`--list <file>`, one tag per line, optionally `<tag> <unix seconds tagged>`):

| Rule | Fails when |
|---|---|
| `tag-format` | a tag is none of the forms above |
| `tag-unknown-app` | a prefix names no workspace folder, or a single-app repo uses a prefix |
| `release-without-build` | `vX.Y.Z` exists without any upload tag of that version |
| `build-scheme-mixed` | one app has shared and per-platform upload tags |
| `build-number-reused` | one app and platform uses a build number twice |
| `build-number-order` | a higher version has a lower build number, or (when every tag of that app and platform has a tagger date) a later tag has a lower number, also within one version |

**The tag namespace belongs to releases.** By default every tag must parse, because a stray tag (`backup-before-rebase`, a hand-made `v1.4` marker) is exactly what the check exists to catch, and release tooling that lists tags would trip over it. A repo that also tags other things on purpose (changesets tags such as `@org/pkg@1.2.0`, an older tooling scheme) passes `--match` with its release globs: `--match 'v*'`, or `--match '*/v*'` when multi-package. A tag outside every glob is ignored (the output counts them); a tag inside one must still parse.

There are no tags before the first upload; the check then exits 2 ("there are no tags to check"), never a silent pass. Run it after the release step tags, or pass `--list` with the planned names.

## When multi-package

With npm workspaces, each tag starts with the app's workspace folder name: `mobile/v1.4.0+14`, `mobile/v1.4.0`. `check-tags.mjs` reads the workspace folders from `package.json` `workspaces` and fails a prefix that names none; build-number rules apply per app. Release commits use the app folder as their scope (`chore(mobile): build 14`).
