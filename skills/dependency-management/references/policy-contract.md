# The dependency policy contract (contracts/dependency-policy.json)

The one repo-owned file that holds the app's dependency facts: which packages it may use, at which
version and specifier, where each goes and why; held-back majors; packages never to add; banned
packages; the licence policy. The checkers of this skill stay strict and read the facts from here;
the app's own gate (`scripts/deps/check-deps.ts`) and licence audit read the same file, so a rule
holds in CI even where this skill is not installed. Read this before creating, editing or reviewing
the file.

## Contents

- Where it lives
- Creating it
- Keys
- A row
- Bans: the supply-chain floor and the profiles
- Licences
- What reads which key
- Editing rules

## Where it lives

`contracts/dependency-policy.json` at the repo root. Another place: set `"dependencyPolicy":
"<repo-relative path>"` in `rn-skills.config.json` (the key this skill reads), or pass `--policy
<path>` to either script. A `contractsDir` in `rn-skills.config.json` moves the default with it. When
multi-package there is still one policy, at the root. The app's own gates find it the same way
(`readDependencyPolicy` in `scripts/deps/dependency-policy.ts`: `dependencyPolicy`, else
`<contractsDir>/dependency-policy.json`, else the default), and both `check-deps.ts` and
`audit-licenses.ts` fail when the file is missing instead of falling back to defaults. Only `--policy`
has no equivalent there: move the file with `rn-skills.config.json` rather than the option.

## Creating it

1. Copy `templates/contracts/dependency-policy.json` (the canonical stack verified on 2026-10-03,
   Expo SDK 57) to `contracts/dependency-policy.json`.
2. Delete the rows the app will never use (a row is a permission, not a requirement), and the
   `doNotAdd` entries the app decided against.
3. If the app opts into a profile, add its name to `profiles` and paste the profile's entries from
   `assets/banned-packages.json` into `banned` (the checker prints each missing one, ready to paste).
4. Run `node ${CLAUDE_SKILL_DIR}/scripts/check-deps-policy.mjs .` until it prints `RESULT: PASS`, and
   commit the file with a `Gate-Change:` trailer, like `.npmrc` (git-commits-and-reporting owns the
   trailer; the commit hook enforces it only when the app's `gatedPaths` list, which quality-gates
   owns, names the file, so check that it does).

## Keys

| Key | Type | Meaning |
|---|---|---|
| `$comment` | string | free text for the reader; allowed in every object of the file |
| `sdk` | integer | the Expo SDK major the table is for (`57`); `table-sdk` fails when the app's `expo` is on another major |
| `verified` | string | the date the table was last verified (refresh it with every re-verification) |
| `profiles` | string[] | opt-in ban profiles: `offline-only`, `no-telemetry` |
| `packages` | object | the rows, keyed by package name (next section) |
| `heldBack` | `{ package, allowed, trigger }[]` | `allowed` is a regex on the bare version (`"^9\\."`); a version past it fails `held-back` until the written `trigger` happens |
| `doNotAdd` | `{ "<name>": "<reason>" }` | packages that are wrong rather than dangerous (duplicates of the stack, and `eas-cli`, a global tool expo-doctor refuses in a project); checked as direct dependencies (`do-not-add`) and in committed npx calls, which would install them into the npx cache (`npx-install`) |
| `banned` | `{ pattern, scope, reason, useInstead?, source? }[]` | `pattern` is a regex on the package name; `scope` `anywhere` (fail at any depth of the lockfile) or `direct` (fail only as a direct dependency) |
| `licenses` | `{ allowed: string[], exceptions: { "<name>": { license, reason } } }` | SPDX ids shipped code may use, and approved exceptions |

`check-deps-policy.mjs` reports every shape problem as `policy-contract` with the key that is wrong,
including **unknown keys** at the top level, in a row, a companion, a `heldBack` or `banned` entry,
`licenses` and its exceptions, with the closest known key (`heldback is not a key of the contract
(did you mean "heldBack"?)`): every reader ignores an unknown key, so a typo would silently switch
its guard off. `plan-dependency.mjs` refuses to plan against a missing or broken policy (exit 2).

The release age is not a policy key: it is the `.npmrc` line `min-release-age`, at least 7 days. An
app may be stricter (`min-release-age=14`); the checkers, the plan's age check and the app's gate
(`release-age-excludes.ts`, `expo-patch-age.ts`) read that value. A value below 7 fails
`npmrc-policy`. The `.npmrc` (with `strict-allow-scripts=true`), the root `package.json` `engines`
and `allowScripts`, the `NPM_CONFIG_*` variables in `eas.json` and GitHub workflows, and
`EAS_NO_FROZEN_LOCKFILE` in `eas.json` are checked beside the policy (`npmrc-policy`,
`npmrc-exclude`, `engines`, `unpinned-approval`, `npm-env`; the release-age and supply-chain
references).

`table-map` reads the rows together with Expo's module map: a row for a package in the map
(`jest-expo`, `expo-router`, `react-native-screens`) must pin a version the map's specifier accepts,
so a stale row cannot survive an SDK move.

## A row

```json
"expo-haptics": {
  "version": "57.0.3",
  "spec": "~57.0.3",
  "install": "expo",
  "where": "app",
  "native": true,
  "why": "haptic feedback behind HapticsPort (audio-and-haptics-feedback)"
}
```

| Field | Required | Meaning |
|---|---|---|
| `version` | yes | the exact version that installs (for `~4.26.0` it is `4.26.2`, what the lockfile holds) |
| `spec` | yes | the `package.json` specifier: Expo's `~x.y.z` for an Expo-managed runtime module, else the exact version; it must accept `version` |
| `install` | yes | `expo` (`npx expo install <pkg>@<spec>`) or `npm` (`npm install <pkg>@<version>` under `save-exact`) |
| `where` | yes | `app` (runtime `dependencies`), `dev` (`devDependencies`); when multi-package `app` means the app workspaces, `dev` the root, a workspace folder (`packages/core`) a library only that package uses, and a list (`["app", "packages/core"]`) a library the apps and that package both import (one specifier everywhere, `lockstep`). A workspace folder needs `install: "npm"`: `npx expo install` writes only into an Expo app, so a shared package lists an Expo-managed package as a `"*"` peer and the row stays `app` |
| `why` | yes | why this package and this version, in one line |
| `native` | no | `true` for a package with iOS or Android code: a change needs a rebuild, and `unused-dependency` checks that some code uses it |
| `implicitUse` | no | why no code imports it (a peer another package loads, a config-only module); `unused-dependency` skips it |
| `companions` | no | `{ package, version, via: "install" \| "overrides", why }[]`: packages pinned with this row because it lets them float |
| `deprecated` | no | why a package npm marks deprecated is kept, and until when (`deprecated` fails without it) |
| `override` | no | `true` when the root `overrides` may pin this package (a deliberate transitive pin); the override must equal `version` |

## Bans: the supply-chain floor and the profiles

`assets/banned-packages.json` holds the lists; every entry has a `pattern`, a `scope`, a `reason` and
what to use instead.

- **The supply-chain floor** (always on): compromised or protestware packages at any depth
  (`flatmap-stream`, `node-ipc`, `peacenotwar`) and npm-deprecated packages that stale examples still
  install, as direct dependencies (`expo-cli`, `expo-random`, `react-native-unimodules`,
  `@react-native-community/async-storage`, `metro-react-native-babel-preset`, `request`,
  `node-sass`, `expo-firebase-analytics`). Deprecations verified with `npm view <pkg> deprecated` on
  2026-10-03.
- **`offline-only`** (the profile privacy-and-store-declarations decides): OTA updates, the
  development client, NetInfo's reachability probe, RevenueCat, Firebase, crash reporters, Expo
  telemetry, push notifications, analytics SDKs, web views (anywhere) and HTTP clients (direct).
- **`no-telemetry`**: Firebase, crash reporters, Expo telemetry and product analytics (anywhere).
  `offline-only` bans every one of these too (an app without network sends no telemetry), so an
  offline app lists `offline-only` alone.

The checkers enforce the floor and every named profile whether or not the policy lists them, and
`policy-contract` fails until `banned` holds them all, because the app's own gate reads only the
policy. The app adds its own bans to the same list (give them `"source": "app"`).

## Licences

`licenses.allowed` defaults to the permissive set `MIT`, `ISC`, `Apache-2.0`, `BSD-2-Clause`,
`BSD-3-Clause`, `0BSD`, `OFL-1.1`, `CC0-1.0`. In an SPDX expression `OR` needs one allowed side and
`AND` needs every side. An exception names the exact licence and a real reason (at least ten
characters; `license-exceptions` checks it) and stops applying if the package changes licence. Only
shipped code is audited: `npm run audit:licenses` reads the source maps of a release export, so build
tools in the lockfile (Expo CLI's `lightningcss`, `caniuse-lite`) never fail it, and the native SDKs
a native module brings through CocoaPods and Gradle are not in it either (read them by hand after a
native change; the supply-chain reference says how). Dev-only tools may
use other licences (`eslint-plugin-sonarjs` is LGPL-3.0-only, never shipped); `plan-dependency.mjs`
checks the licence of a runtime row only.

## What reads which key

| Reader | Keys |
|---|---|
| `check-deps-policy.mjs` (this skill) | everything (and `packages` against Expo's module map: `table-map`; `doNotAdd` and `banned` also against committed npx calls: `npx-install`) |
| `plan-dependency.mjs` (this skill) | `packages`, `heldBack`, `doNotAdd`, `banned`, `profiles`, `licenses` |
| `scripts/deps/check-deps.ts` (the app's gate in `npm run verify`) | `banned` |
| `scripts/audit/audit-licenses.ts` (`npm run audit:licenses`) | `licenses` |

## Editing rules

- A row changes in the same commit as `package.json` and `package-lock.json`, never alone.
- Adding a row, a dated exception, a licence exception or a `deprecated` reason is a decision of the
  developer: stop and ask, with the facts `plan-dependency.mjs <pkg>@<v> . --online` prints.
- Removing a package removes its row (unless it only moves place) and any override it needed.
- An Expo SDK move rewrites the Expo-managed rows, `sdk` and `verified` in one commit (the
  expo-sdk-upgrade skill).
