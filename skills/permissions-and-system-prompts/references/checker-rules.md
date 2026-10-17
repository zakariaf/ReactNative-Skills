# check-permissions.mjs: what each rule reads and why

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-permissions.mjs [repo-root] [--src-dir <dir>] [--contract <file>] [--native-config <file>] [--json]
```

Exit 0 pass (SKIP lines and NOT APPLICABLE included), 1 problems, 2 bad input. The last line is always
`RESULT: PASS` or `RESULT: FAIL (<n> problems)`.

## Contents

1. What it scans
2. When it does not apply, and what it skips
3. The contract (`contracts/permissions.json`)
4. The rules
5. Known limits
6. Changing the checker

## 1. What it scans

- Every `.ts`, `.tsx`, `.js`, `.jsx` under the source folder (`resolveLayout`: `src/`, or `--src-dir`),
  through check-lib's repo walk: tests (`*.test.*`, `__mocks__/`, `test/`), declaration files and every
  folder holding a `SKILL.md` (installed skills) are skipped.
- A **permission use** is an occurrence of a function of `assets/permission-apis.json` imported from
  its module: a call or a reference (`read: getCameraPermissionsAsync`), a namespace or object member
  (`Location.requestForegroundPermissionsAsync`, `Camera.requestCameraPermissionsAsync`), or a
  `PermissionsAndroid.request|requestMultiple|check` call (its kind from `PERMISSIONS.X` or an
  `'android.permission.X'` string in the file). `requestPermissionsAsync(true)` and
  `getPermissionsAsync(true)` of expo-media-library are the `photos-add` kind (imported by name or
  through a namespace); without the `true` they are full library read (`photos`). A module is matched
  by package name, so a subpath import (`expo-media-library/legacy`) counts as its package.
- `contracts/permissions.json` (or `--contract`, or `rn-skills.config.json` `"permissionsContract"`).
- `contracts/native-config.json` (or `--native-config`) when it exists, else `app.config.ts`.
- The source catalog `<i18n>/catalogs/<SOURCE_LANGUAGE>.json` (`SOURCE_LANGUAGE` read from
  `<i18n>/languages.ts`, default `en`).

## 2. When it does not apply, and what it skips

- `NOT APPLICABLE: react-native is not in package.json`.
- `NOT APPLICABLE: no permission module (...) is in package.json and no code uses PermissionsAndroid`
  (and there is no contract).
- `SKIP app.config.ts [purpose-string] not yet created (expo-project-bootstrap creates it)`: no app
  config and no snapshot yet.
- `SKIP <i18n>/catalogs/<lang>.json [copy-keys] not yet created (i18n-strings-and-catalogs creates it)`.
- App Tracking Transparency (expo-tracking-transparency) is never checked here: `admob-ads-and-consent`
  owns it, and a `tracking` contract entry is a `contract` problem that says so.

## 3. The contract (`contracts/permissions.json`)

`templates/contracts/permissions.schema.json` is the full schema. One entry per permission kind:

| Field | Meaning |
|---|---|
| `kind` | `camera`, `microphone`, `photos`, `photos-add`, `location`, `location-background`, `contacts`, `calendar`, `reminders`, `motion`, `notifications`, `bluetooth` |
| `feature` | what the person gets (the reviewer reads it against the purpose string) |
| `askedFrom` | the model hook or service flow that asks, from a press |
| `platforms` | `ios` and/or `android` |
| `purposeKey` | catalog key of the iOS purpose string (kinds with an iOS key) |
| `shouldExplainFirst` | true: the explain sheet shows before the first dialog |
| `explain` | `title`, `body`, `continue`, `dismiss` (dismiss is Android's "No thanks" in the rationale) |
| `settings` | `title`, `body`, `open`, `dismiss` (the blocked sheet) |
| `unavailable` | optional: `title`, `body`, `dismiss` (no such capability, or the read failed); when present, all three keys, and `copy-keys` checks them |

## 4. The rules

| Rule | Fails when | Why |
|---|---|---|
| `contract` | code uses a permission and the contract is missing; invalid JSON; an entry with an unknown kind, a short `feature`, an `askedFrom` outside the source folder, no `platforms`, no `purposeKey` for an iOS kind, no `shouldExplainFirst`, missing copy keys, a kind twice, `location-background` without `location`, or `tracking` | the inventory is what the reviewer, the store forms and the other rules read |
| `undeclared-permission` | a use of a kind the contract does not list | a new permission without its purpose, copy and test is how vague dialogs ship |
| `contract-unused` | a listed kind no code reads or requests | stale entries keep purpose strings and store answers for things the app no longer does |
| `request-boundary` | a read or request outside `<services>/**/*-adapter.ts` | the adapter maps the OS answer to the app's states once; screens see `blocked`, not `canAskAgain` |
| `system-hook` | a module hook (`useCameraPermissions`, `usePermissions`, `useForegroundPermissions`, ...) anywhere | it asks without the explain sheet, the blocked path or the foreground re-read |
| `ask-from-action` | an OS request function, `.requestPermission(` or `.requestAccess(` inside `useEffect`, `useLayoutEffect`, `useInsertionEffect`, `useFocusEffect`, at module scope, or anywhere in `<routes>/_layout.tsx` and `<features>/root-navigator/**` | a dialog that appears without a press is refused more and spends the one iOS chance |
| `can-ask-again` | a file that reads Expo permission answers never mentions `canAskAgain` (nor does any repo file it imports); a `PermissionsAndroid` file without `NEVER_ASK_AGAIN` | without it, denied and blocked are the same and the app re-requests a dialog that cannot appear |
| `photos-limited` | a photos read or request (expo-media-library, expo-image-picker) without `accessPrivileges` in the file or its local imports | iOS 14+ and Android 14+ partial access is neither granted nor denied |
| `picker-no-permission` | expo-image-picker's media-library permission functions or hook | `launchImageLibraryAsync` needs no permission; asking adds a dialog and a store declaration for nothing |
| `location-foreground-first` | `requestBackgroundPermissionsAsync` in a file with no foreground location read or request | background access is a second step on both platforms |
| `open-settings` | the contract lists permissions and no source file calls `Linking.openSettings()` (react-native or expo-linking) | a blocked permission has no way back |
| `recheck-on-active` | a `use-*.ts(x)` hook calls `.permission(` and mentions none of `useIsAppActive`, `AppState`, `useSyncExternalStore`, `createPermissionStatusMirror`, `usePermissionGate` | a change made in Settings stays invisible until a restart |
| `purpose-string` | snapshot: an iOS kind's key is missing from `ios.infoPlist`; `app.config.ts` (always, snapshot or not): its plugin option is `false`; without a snapshot also: neither an option nor the key (outside `usageDescriptions`) is set | iOS terminates an app that requests without the key; a plugin default is vague English |
| `android-blocked` | snapshot: the kind's permission carries `tools:node=remove`; `app.config.ts` (always): it is in `blockedPermissions`, or expo-image-picker's `cameraPermission`/`microphonePermission` is `false` | a blocked permission is refused without a dialog on every phone |
| `copy-keys` | a contract key is missing from the source catalog | the sheets and the dialog would show nothing or throw |
| `asked-from` | `askedFrom` is missing, does not ask (`usePermissionGate`, `.requestAccess(`, `.requestPermission(`, a request function), passes a literal `shouldExplainFirst` other than the contract's, or has no sibling `.test.ts(x)` naming both `blocked` and `denied`/`declined` | the contract's context must be real code with tests for the outcomes people actually hit |

## 5. Known limits

- The `app.config.ts` reading is textual: an option set through a helper function or a spread is not
  seen. Keep the native snapshot (`expo-prebuild-and-config-plugins`) and the checker reads the exact
  result instead. The snapshot is trusted as written: with one present, only the cheap config checks
  (an asked kind's option `false`, the kind in `blockedPermissions`, an expo-image-picker block) still
  read `app.config.ts`. A stale snapshot is `expo-prebuild-and-config-plugins`' native-drift rule
  (`check-native-snapshot.mjs`), which the definition of done runs too.
- The API table names functions by module; a wrapper module of the app's own that re-exports a
  permission function under another name is not followed.
- Library manifests merge after prebuild, so the checker cannot prove a permission is declared on
  Android, only that the app does not remove it.
- `ask-from-action` finds asks by name (`.requestPermission(`, `.requestAccess(`, the request
  functions). A wrapper with another name hides an ask from it, and so does a same-file helper an
  effect calls (`const askNow = () => { gate.requestAccess(capture); }; useEffect(() => { askNow(); }, [])`):
  the rule reads only the effect callback's own body. The `request-boundary` and `asked-from` rules
  still pin where asking may happen; a review of the asking model catches the helper.
- `recheck-on-active` looks at hook files only; a store that caches a permission is the same bug and
  is the reviewer's to catch.

## 6. Changing the checker

Add a module or function to `assets/permission-apis.json` (with the version you read it in), then a
`bad-*` case that uses it. Each rule has a `bad-*` case in `tests/fixtures/check-permissions/` that
plants exactly one bug; `good/` is the shipped templates plus the Tasks example, so the templates are
proven to pass. Run `node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs` (`--case bad-*`,
`--materialize <dir>` to read the assembled repos).
