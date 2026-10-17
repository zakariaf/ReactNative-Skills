# Example: the privacy audit before a Tasks app release

The order an agent follows, the output it expects, what it does with a finding, and the report.
Shape only: the app, its SDKs and its numbers are illustrative.

## 1. Static audit (any time, and before every push)

```sh
node ${CLAUDE_SKILL_DIR}/scripts/audit-repo.mjs .
```

```text
SKIP ios/Podfile.lock [vendor-pod] not yet created (npx expo prebuild --platform ios creates it)
audit-repo: 214 source files checked, 0 problems, 1 skipped
RESULT: PASS
```

A typical failure and its fix:

```text
FAIL src/features/tasks/task-row.tsx:14 [remote-url] remote URL https://cdn.acme.app/avatar.png Fix: Remote images, fonts and downloads make requests without fetch. ...
```

The avatar comes from the API response instead (the URL never sits in a component), and the check
is rerun.

## 2. A new SDK

The team added crash reporting. The audit names it before anything ships:

```text
FAIL package.json [network-sdk] @sentry/react-native (crash reporting) is installed but not declared in contracts/privacy.json "sdks" Fix: Declare it ...
```

The agent declares it from the vendor's disclosure page (crash and performance data, not linked, not
tracking: crash-reporting-and-observability scrubs user data), prebuilds, and reruns:

```sh
npx expo prebuild --platform ios --clean
node ${CLAUDE_SKILL_DIR}/scripts/audit-privacy-manifest.mjs .
```

```text
FAIL contracts/privacy.json [undeclared-collection] pod Sentry collects other-diagnostic-data (linked=false, tracking=false), but sdks["@sentry/react-native"].collects does not declare it Fix: ...
```

The pod's own manifest (Sentry Cocoa 8.58.0) also declares other diagnostic data, for App
Functionality, which the disclosure page did not mention. The agent adds that row; the pod's
required reasons (UserDefaults `CA92.1`, SystemBootTime `35F9.1`, FileTimestamp `C617.1`) are already
in `PRIVACY_MANIFESTS`, so no `missing-reason` appears (a pod with a new reason would add one to
`PRIVACY_MANIFESTS` and its test). `audit-repo.mjs` also fails the new trunk pod (`vendor-pod`) until
the SDK entry lists it, so the entry gets `"pods": ["Sentry"]`. The agent prebuilds again and reruns
until `RESULT: PASS`.

## 3. The shipped JavaScript

```sh
npm run export:audit
node ${CLAUDE_SKILL_DIR}/scripts/audit-bundle.mjs .
```

```text
NOTE STALE expo-file-system: in the baseline but not found (delete the entry once the package has left)
FAIL _expo/static/js/ios/index-….hbc.map [baseline-new] NEW react-native-calendars: remoteUrl (not in the baseline) Fix: ...
```

`@sentry/react-native` ships its own `fetch` transport, and the bundle audit says nothing about it:
the SDK is declared, and a declaration covers whatever it can do. The calendar package is not a
network SDK; the agent reads the module the finding names, sees a documentation link inside an error
message, and adds a `"js"` baseline entry ("documentation link in an error message; no request is
made"). `contracts/network-baseline.json` is a gated path, so the commit carries
`Gate-Change: network baseline (calendar docs link)` and the agent stops for the reviewer's approval
before pushing. The STALE note is not a failure; the entry goes in the same change because the app no
longer uses expo-file-system.

## 4. The release build

```sh
node ${CLAUDE_SKILL_DIR}/scripts/audit-app-bundle.mjs . --app build/ipa-check/Payload/Tasks.app --android-manifest build/merged-manifest.xml
```

```text
FAIL build/merged-manifest.xml:9 [permission-answer] android.permission.READ_EXTERNAL_STORAGE is in the release manifest, but contracts/privacy.json answers no "storage" Fix: ...
```

The app never reads shared storage, so the agent blocks the permission
(`android: { blockedPermissions: ['android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE'] }`),
rebuilds, and the audit passes.

## 5. The answers and the report

```sh
node ${CLAUDE_SKILL_DIR}/scripts/audit-repo.mjs . --answers
```

The report to the developer, in plain words:

"The privacy audit passed for Tasks 2.3 (build 41): the app talks only to our server through the API
layer, every SDK that goes online is declared, the iOS privacy manifest covers every SDK, and the
release build carries no development or tracking surprises. Two things need you: (1) one audit
allow-list entry for a documentation link inside the calendar package, waiting for your approval; (2) the store
privacy forms change: crash data, performance data and other diagnostic data, not linked to you, not
used for tracking, now appear in App Privacy and in Data safety (App info and performance). The full answers are below;
please enter them in App Store Connect and Play Console."
