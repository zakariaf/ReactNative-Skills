# Secrets: keys, keystores and credentials

## Contents

- What counts as a secret here
- Where secrets live
- What audit-repo checks
- Rules for agents and scripts
- Leak response (human)

## What counts as a secret here

Material that lets someone publish, sign or impersonate the app: the App Store Connect API key
(`AuthKey_<KEYID>.p8`, `ApiKey_*`), Apple certificates (`*.p12`) and provisioning profiles
(`*.mobileprovision`), the Android upload keystore (`*.keystore`, `*.jks`, with `key.properties` or
`keystore.properties` holding its passwords), Google Play service-account JSON
(`*service-account*.json`), EAS's local `credentials.json`, and any PEM private key. Not secrets:
AdMob app and unit IDs, the API base URL, `google-services.json` and other public client config
(they ship in every build). Anything in an `EXPO_PUBLIC_*` variable is public by definition
(app-variants-and-environment owns that rule and the bundle scan for leaked values).

## Where secrets live

- **EAS (default):** EAS manages signing credentials server side (`eas credentials`); App Store
  Connect and Play keys for submit live in EAS too, never in the repo (eas-build-and-submit).
- **Local lane:** the files live outside the repo (for example `~/.appstoreconnect/private_keys/`,
  mode 600), and the release scripts receive only their path and IDs through the environment of the
  developer's shell (ios-release-testflight, android-release-play).
- **CI:** encrypted CI secrets, written to a temporary file outside the checkout for the one job that
  signs (ci-pipeline-and-gates).

## What audit-repo checks

| Rule | Fails when |
|---|---|
| `gitignore-secrets` | `.gitignore` lacks one of `*.p8`, `*.p12`, `*.mobileprovision`, `*.keystore`, `*.jks`, `AuthKey_*`, `ApiKey_*`, `credentials.json`, `*.xcarchive`, `*.ipa`, `*.aab`, `*.apk` (exact lines; `*service-account*.json`, `key.properties` and `keystore.properties` join the list once the canonical `.gitignore` carries them; until then `secret-file` catches those files wherever they sit) |
| `secret-file` | a key, keystore, profile, service-account JSON, `credentials.json` or `key.properties` sits anywhere in the repo, ignored or not: an agent or a script can still read it, and one `git add -f` commits it |
| `private-key` | a file holds PEM private-key armour (five dashes, `BEGIN`, optional `EC`/`RSA`/`ENCRYPTED`, `PRIVATE KEY`, five dashes); prose that only names the marker is fine |
| `deny-rules` | `.claude/settings.json` exists and its `permissions.deny` lacks `Read(**/*.p8)`, `Read(**/AuthKey_*)`, `Read(**/*.p12)`, `Read(**/*.mobileprovision)`, `Read(**/*.keystore)`, `Read(**/*.jks)`, `Read(**/credentials.json)`, `Read(**/*service-account*.json)`, `Read(**/key.properties)` or `Read(**/keystore.properties)` (the canonical `.claude/settings.json` denies all ten) |

The secret scan is the one scan that also reads installed agent skill folders (`.agents/`,
`.claude/`, `skills/`): a key is a key wherever it sits. It skips `node_modules`, build output and the
generated `ios/` and `android/` folders (prebuild writes a public `android/app/debug.keystore` there,
which is not a secret). Self-test fixtures plant keys defused (`XKEY`) and complete them at run time,
so no key-shaped text is ever committed, even in a test.

Other agents: Cursor reads `.cursorignore`, Codex and others their own ignore or sandbox settings;
mirror the same patterns there when the team uses them.

## Rules for agents and scripts

- Never open, print, copy, move, commit or log a key file, a keystore password or a token made from
  them (an App Store Connect JWT, an `Authorization` header). Error messages carry the API's error
  body only.
- One module reads a key into memory, never passes it on a command line or through an environment
  variable, and never writes it to a temporary file. Deny rules guard an agent's own file tools, not
  every child process; the one-reader rule is the real guard.
- Debugging an upload: log the status and the error body, never the request.

## Leak response (human)

Stop and explain to the developer in plain words; each step is theirs:

1. Revoke the key where it was issued (App Store Connect: Users and Access > Integrations; Google
   Cloud: the service account's keys; EAS: `eas credentials`). An upload keystore that leaked needs an
   upload key reset through Play Console support (Play App Signing keeps the app signing key safe).
2. Create a new key, store it where it belongs (above), update the IDs the scripts read.
3. Check history and outputs: `git log -p -S "PRIVATE KEY-----"`, the `reports/` folder, CI logs.
