# Signing and keys

What signs an Android release, where each secret lives, and the one way each is read. The agent that
runs a release usually works without a human watching every command, so these rules are what keeps a
key from leaking: never open, print, copy, hash, commit or log the upload key, a password, the
service-account JSON or an access token.

## Contents

- Play App Signing: two keys
- The upload key on the EAS lane
- The upload key on the local lane
- How the local release build is signed
- The registered fingerprint
- The service-account key
- What the agent may and may not do
- If a secret leaks

## Play App Signing: two keys

Every app published as an Android App Bundle uses Play App Signing (required for new apps since August
2021, when Play stopped taking APKs for new apps). Two keys are involved:

| Key | Who holds it | What it signs | If lost or leaked |
|---|---|---|---|
| App-signing key | Google | the APKs Play generates from the bundle and delivers to devices | cannot be lost by the team; Google keeps it |
| Upload key | the team (EAS servers on the EAS lane, the developer's machine on the local lane) | the `.aab` that is uploaded; Google checks it, then re-signs | the developer requests an upload key reset in Play Console (App integrity); uploads wait until Google confirms |

So a lost upload key is recoverable, but it is still a secret: whoever holds it (and the service
account) can upload builds as the app. The first upload registers the upload key's certificate; Play
refuses every later bundle signed by another key.

Users see the app-signing key's certificate, not the upload key's. Anything that pins a signing
certificate at runtime (Google Sign-In OAuth clients, Firebase, App Links `assetlinks.json`) needs the
**app-signing** key's SHA-256 from Play Console, plus the upload key's for builds installed outside
Play. deep-links-and-universal-links owns `assetlinks.json`.

## The upload key on the EAS lane

With `credentialsSource: "remote"` (the default), EAS generates the Android upload keystore on the
first production build and keeps it on its servers; nothing lives in the repo or on a laptop.

- See its fingerprint with `eas credentials -p android` (choose the production build profile): it
  prints the keystore's SHA-1 and SHA-256. That SHA-256 goes into `contracts/android-release.json`
  `uploadCertificateSha256`.
- Never let a second keystore be generated for the same application id (a new Expo account, a project
  re-created, `eas credentials` "Set up a new keystore"): Play refuses its bundles. If one already
  uploaded with the old key, keep using that one.
- Download a backup of the keystore only when the developer asks (`eas credentials`, "Download
  credentials"); it then becomes a local-lane secret with every rule below.
- **`credentials.json`** is EAS's local-credentials file (`credentialsSource: "local"` in a build
  profile): `android.keystore.keystorePath`, `keystorePassword`, `keyAlias`, `keyPassword` in plain
  text, next to `eas.json`. It follows the keystore's rules: never opened, printed or committed,
  ignored by git and denied to agents (`Read(**/credentials.json)`, rule `secrets-ignored`), and
  its `keystorePath` points outside the repo. This library's EAS lane keeps credentials remote, so
  the file normally does not exist; if a team needs it, the developer writes it by hand.

## The upload key on the local lane

- Path: `~/.android-keys/<applicationId>-upload.jks` (`uploadKeyPathOf` in
  `scripts/release-android/upload-key.ts`), outside every repo, mode 600, one key per app.
- Generated only with the developer's go. The password comes from one environment variable of that
  one process (`-storepass:env`), never the command line or the process list:

```sh
mkdir -p ~/.android-keys && chmod 700 ~/.android-keys
# UPLOAD_STORE_PASSWORD: generated in this shell (for example openssl rand -hex 24), never echoed
"$JAVA_HOME/bin/keytool" -genkeypair -keystore ~/.android-keys/com.acme.tasks-upload.jks \
  -storetype PKCS12 -alias upload -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=Acme Upload, O=Acme" \
  -storepass:env UPLOAD_STORE_PASSWORD -keypass:env UPLOAD_STORE_PASSWORD
chmod 600 ~/.android-keys/com.acme.tasks-upload.jks
```

- **One password for the store and the key.** JDK 17's keystore type is PKCS12, and PKCS12 keeps
  one password: given a different `-keypass`, keytool prints "Different store and key passwords not
  supported for PKCS12 KeyStores. Ignoring user-specified -keypass value." and the key gets the store
  password. Signing with a separate key password then fails: `jarsigner` says "key associated with
  upload not a private key", and Gradle's `signReleaseBundle` says "Cannot recover key" or "Get Key
  failed" (Gradle's wording from the docs). Verified on 2026-10-14 with OpenJDK 17.0.11 (Android
  Studio's JBR): the two-password form reproduced the warning and the `jarsigner` failure, and a
  keystore made as above signs with the one password.
  `keytoolGenerateArgs` builds exactly these arguments. Ten thousand days (27 years) outlives any
  app; RSA 4096 is accepted by Play.
- The same process writes the four properties into `~/.gradle/gradle.properties` (mode 600), under
  names of this app only (`uploadSigningProperties`), and never echoes them. The store and key
  password properties hold the same value (the Android Gradle plugin's signing config asks for
  both):

```properties
COM_ACME_TASKS_UPLOAD_STORE_FILE=<home folder>/.android-keys/com.acme.tasks-upload.jks
COM_ACME_TASKS_UPLOAD_STORE_PASSWORD=<the generated password>
COM_ACME_TASKS_UPLOAD_KEY_ALIAS=upload
COM_ACME_TASKS_UPLOAD_KEY_PASSWORD=<the same password>
```

  Gradle reads `~/.gradle/gradle.properties` by itself, so no tool of the app ever handles a
  password. The names carry the application id, so no other project on the machine signs with them.
- The key is checked only by `stat` (`uploadKeyProblems`: outside the repo, a file, mode 600). The
  keystore and `gradle.properties` are never opened by any tool of the app or by the agent.

## How the local release build is signed

React Native's template signs release builds with the debug keystore (verified in
expo-template-bare-minimum 57.0.30: `release { ... signingConfig signingConfigs.debug }`). The
config plugin `plugins/with-upload-signing.ts`, listed in `app.config.ts` as
`['./plugins/with-upload-signing.ts', { applicationId: BASE.appId }]`, edits the generated
`android/app/build.gradle` at prebuild:

- it adds a signing config `upload` that reads the four properties when they exist;
- release builds use `upload` when `<PREFIX>_UPLOAD_STORE_FILE` exists, otherwise the debug key, so
  emulator builds, a keyless rehearsal and an EAS build (which injects its own signing) need no key;
- it throws at prebuild when the template lost the lines it edits, so a React Native upgrade never
  drops the signing silently; it is idempotent (`prebuild --no-clean` runs it again).

Verified on 2026-10-14 by a real `npx expo prebuild --platform android` of the reference app:
the generated `build.gradle` held the `upload` block and the conditional release line.

A bundle signed with the debug key, or not signed, fails `check-store-aab.mjs` rule `signing`. Only
`--rehearsal` skips that rule, and a rehearsal is never release evidence.

Never pass `-Pandroid.injected.signing.store.password=...` (the password lands in the process list,
shell history and CI logs) and never write a password into `build.gradle`, `app.config.ts`, a
`keystore.properties`, the project's `gradle.properties` (the `MYAPP_UPLOAD_STORE_PASSWORD=` form
React Native's signing guide shows belongs in `~/.gradle/gradle.properties`, never in the repo) or a
`.env*` file. `check-play-release-setup.mjs` rule `inline-secrets` catches these when they are
written plainly: in code, `package.json` scripts, `eas.json`, CI workflows and shell scripts, and in
every `*.properties` and `.env*` file of the repo (generated `android/` aside), as a line whose key
names a store or key password (`storePassword=`, `KEY_PASSWORD:`, `...STORE_PASSWORD=`), even in a
file git ignores, since agents and tools read the working tree; in code the literal forms
`storePassword: '...'` (an object property or plugin option), `storePassword = '...'` and Gradle's
`storePassword '...'` are caught. A documentation placeholder in `.env.example`
(`UPLOAD_STORE_PASSWORD=<your password>`, `__UPLOAD_STORE_PASSWORD__`) or an empty value is allowed. Its limits: it is a pattern match,
so a password assembled from pieces, read from another file, passed through an unusual flag, kept
under a key that names no password, or written as a `$VAR` reference passes it, and the debug
keystore's public password `android` is allowed on purpose. Review any change to signing code by
hand.

## The registered fingerprint

`uploadCertificateSha256` in the contract is the upload certificate's SHA-256 as Play Console (App
integrity), `keytool -printcert` and `eas credentials` print it: 32 upper-case hex pairs separated
by colons. It is public (a certificate fingerprint, not a key) and safe to commit. With it, the gate
proves more than "not the debug key": it proves the bundle is signed by the one key Play will accept.

- Before the first upload it is `null`. The gate then fails with the fingerprint it saw. Confirm that
  this is the key the team keeps (EAS: `eas credentials`; local: the key just generated), write it
  into the contract, commit, and run the gate again.
- After the first upload, compare it once with Play Console (App integrity, Upload key certificate).
- `keytool -printcert -jarfile app-release.aab` shows who signed a bundle; it reads only the
  certificate inside the bundle and is safe. `keytool -list -keystore ...` opens the keystore: never.

## The service-account key

The local lane uploads through the Google Play Developer API with a service account; the EAS lane
uses the same kind of key, uploaded once to EAS (`eas credentials`, Google Service Account) or named
by `serviceAccountKeyPath` in `eas.json` (eas-build-and-submit owns that file).

- Path (local lane): `~/.android-keys/<applicationId>-play-service-account.json`, mode 600. A person
  creates it (human-steps.md, Service account) and saves it there; it is never pasted into a chat.
- Only `play-credentials.ts` names and reads it (`loadServiceAccount`: stat first, then one read into
  memory). `check-play-release-setup.mjs` rule `credentials-read` fails any other file that names it.
- The parsed account exposes only the e-mail and a `signRs256` function; the private key stays in its
  closure, so a log line, `JSON.stringify` or a debugger cannot show it. Parse errors are the module's
  own sentences, never the parser's (V8 quotes the input in JSON errors).
- The access token lives in `play-client.ts`'s closure and is sent only as the `authorization`
  header; errors name the step and Google's one-line message, never a header.

## What the agent may and may not do

| May | May not |
|---|---|
| `stat` the key files and check their place and mode | open, print, copy, move, hash or commit a key, a password, the JSON or a token |
| generate the upload key, with the developer's go, as above | paste a key, a password or a token into a report, a log or the chat |
| `keytool -printcert -jarfile <aab>` (the certificate inside a bundle) | `keytool -list` on a keystore (that opens it) |
| `eas credentials -p android` to read the fingerprint | create, replace or delete EAS credentials without the developer's word |
| delete a key it created by mistake inside the repo, then report it | retry an upload after a 401 or 403 |

`.gitignore` lists `*.jks`, `*.keystore` and `credentials.json`, and `.claude/settings.json` denies
`Read(**/*.jks)`, `Read(**/*.keystore)`, `Read(**/credentials.json)` and
`Read(**/*service-account*.json)` (rule `secrets-ignored`; quality-gates
owns the settings file and the developer approves edits to it). The deny rules are defence in depth;
never opening the files is the real guard.

## If a secret leaks

Stop all release work and send the developer one message (git-commits-and-reporting's stop form):

- **Upload key or a password** (in git, a log, the chat): the developer requests an upload key reset
  in Play Console (App integrity, Upload key certificate, Request upload key reset). After Google
  confirms, generate a new key (local) or let EAS generate one, register its fingerprint in the
  contract, and purge the old file from history only with the developer.
- **Service-account JSON**: the developer deletes that key in the Google Cloud console (IAM and admin,
  Service accounts, Keys) at once and creates a new one.
- **An access token**: it expires within an hour; still report it, and rotate the service-account key
  if the token left the machine.
