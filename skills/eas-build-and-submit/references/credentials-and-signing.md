# Credentials: who holds the keys, what EAS does with them, what the agent never touches

The default is EAS-managed credentials (`credentialsSource: "remote"`): EAS keeps the iOS distribution
certificate, provisioning profiles and push key, the Android upload keystore, and the store API keys
EAS Submit uses. The developer creates or uploads them once, in their own Expo and store accounts; the
agent builds and submits with what is stored and never reads, copies or uploads a key file. Verified on
2026-10-14 against docs.expo.dev (`/app-signing/managed-credentials`, `/app-signing/local-credentials`,
`/submit/ios`, `/submit/android`) and EAS CLI 24.10.0's flags; nothing here was run against a real
Apple, Google or Expo account.

## Contents

- What signs what
- First-time setup (human steps)
- Builds: frozen credentials
- Submit credentials
- Local credentials (credentials.json), when a team must
- CI
- Never
- Leak response

## What signs what

| Credential | Platform | Used by | Created by |
|---|---|---|---|
| Distribution certificate + App Store provisioning profile | iOS | `eas build` (store profile) | EAS on the first interactive `eas build` or `eas credentials`, signed in to the Apple Developer account |
| Ad hoc provisioning profile (registered devices) | iOS | internal builds | EAS, from the devices `eas device:create` registered |
| Apple Push Notifications key | iOS | push (push-notifications) | EAS asks on the next interactive build, or `eas credentials` |
| App Store Connect API key | iOS | `eas submit`, `eas testflight` commands | the developer, `eas credentials --platform ios` > production > "API Key for EAS Submit" |
| Upload keystore | Android | `eas build` | EAS generates it on the first build; Google re-signs with the app signing key held by Play App Signing (android-release-play) |
| Google service account key (JSON) | Android | `eas submit` | the developer, in Google Cloud and Play Console, then uploaded with `eas credentials --platform android` |
| FCM V1 service account key | Android | push (push-notifications) | the developer, uploaded with `eas credentials` |

Store builds of every variant use the production id; development and preview have their own ids
(`.dev`, `.preview`), so each id has its own profiles and, when push or Sign in with Apple is used, its
own registrations (app-variants-and-environment lists the services keyed by id).

## First-time setup (human steps)

Ask the developer for each in one message per step, with what it costs and what waits on it
(git-commits-and-reporting's stop-and-ask list holds the wording rules):

1. **Accounts.** A paid Apple Developer Program membership; a Google Play Developer account; an Expo
   account (an organization when a team builds). The agent cannot create or pay for any of them.
2. **Link the project.** `eas init` writes `extra.eas.projectId` and `owner` into the app config (the
   developer runs it once, logged in; commit the result).
3. **App records.** The App Store Connect app record (or let the first `eas submit` create it, which
   needs an interactive Apple login, so the agent does not do it) and the Google Play app with the
   production package name. Put the Apple ID number into `submit.production.ios.ascAppId`.
4. **iOS signing.** One interactive `eas build --platform ios --profile production` or
   `eas credentials --platform ios` by the developer, signed in to the Apple Developer account, lets EAS
   create and store the distribution certificate and profile.
5. **Submit keys.** A team App Store Connect API key (EAS can generate one during
   `eas credentials --platform ios`, or the developer uploads their own); the Google service account with release permission for the app in
   Play Console (Users and permissions), uploaded through `eas credentials --platform android`.
6. **TestFlight testers.** An internal testing group, or let `eas submit` create one
   (`--auto-testflight-setup`, on by default in EAS CLI 24.10.0); testers install the TestFlight app.
7. **CI token.** A robot or personal access token stored as the CI secret `EXPO_TOKEN`
   (ci-pipeline-and-gates); never in the repo.

Until a step is done, the agent works on what does not need it and says which step is pending.

## Builds: frozen credentials

The agent passes `--non-interactive --freeze-credentials` to every `eas build` (the template
`scripts/eas/eas-commands.ts` always does, and `check-eas-config`'s `eas-commands` rule fails an
`eas build` without `--local` that lacks it). An EAS Workflows `type: build` job has no such parameter
(docs.expo.dev/eas/workflows/pre-packaged-jobs, read 2026-10-16), so there the credentials stay as they
are only because nobody but the developer changes them. `--freeze-credentials` "Prevent[s] the build from updating
credentials in non-interactive mode" (EAS CLI 24.10.0 `build/index.js`): a build never regenerates a
certificate, revokes a profile or rotates a keystore on its own. When EAS reports missing or invalid
credentials, that is a release stop (failure-playbook.md): the developer fixes them with
`eas credentials`, the agent does not retry or switch to local credentials.

## Submit credentials

`eas submit --non-interactive` uses the key stored for the app ("they use the key that is assigned to
your app", Expo docs) unless the submit profile names one. The profile pins `ios.bundleIdentifier` and
`android.applicationId` so the stored key for the production id is found even when the app config was
evaluated without a variant. A CI that brings its own key writes `"ascApiKeyPath": "$ASC_API_KEY_PATH"`
(and the id and issuer as `$ASC_API_KEY_ID`, `$ASC_API_KEY_ISSUER_ID`), filled from secret files at run
time; EAS CLI substitutes environment variables in those keys and in `serviceAccountKeyPath`.

## Local credentials (credentials.json), when a team must

Some teams cannot store keys with a third party. Then a profile sets `"credentialsSource": "local"` and
`credentials.json` at the repo root names the keystore, the `.p12` certificate and the provisioning
profile with their passwords. Rules: `credentials.json` and every file it names are git-ignored
(app-variants-and-environment's `check-env` fails otherwise); the files live outside the repository
folder when possible; the developer fills them; the agent never opens them. For teams without EAS at
all, the local lane is complete in ios-release-testflight and android-release-play.

## CI

CI runs `eas` from a global install (`npm install -g --min-release-age=7 --ignore-scripts
eas-cli@24.10.0`; inside an app with `strict-allow-scripts`, `npx eas-cli` stops with
`ESTRICTALLOWSCRIPTS`, dependency-management verified this) with `EXPO_TOKEN` from a secret. EAS Build
in CI is non-interactive by default in EAS CLI 24.10.0 (`CI` set or no TTY); `eas submit` is not, so
it always gets `--non-interactive`, and both get `--platform`, which non-interactive mode requires.
The workflow itself belongs to ci-pipeline-and-gates.

## Never

- Read, print, copy, move, commit or log a `.p8`, `.p12`, `.jks`, `.keystore`, `.mobileprovision`,
  `credentials.json` or service-account JSON, or paste one into a prompt. Check that a key exists by
  asking the developer or with `eas credentials` output, never by opening it.
- Run `eas credentials` actions that create, remove or replace a credential without the developer's
  word in this session: a revoked distribution certificate breaks every other app of the team that
  uses it.
- Upload keys into `eas.json`, `app.config.ts` `extra`, an `EXPO_PUBLIC_*` variable or an EAS
  environment variable with plain-text visibility.
- Switch from managed to local credentials, or from an API key to an Apple ID login, to get past an
  error.

## Leak response

A key that reached git, a log or a chat is compromised. Tell the developer at once; they revoke it
(App Store Connect > Users and Access > Integrations for an API key; Google Cloud for a service
account key; a new upload key through Play Console's upload key reset for a keystore), create a new
one and store it with `eas credentials`. Find every place it went with
`git log --all -p -S '<a short unique part of the key id, not the key>'` and rewrite or delete those
copies; rotating is the only real fix, because a pushed secret cannot be unpublished.
