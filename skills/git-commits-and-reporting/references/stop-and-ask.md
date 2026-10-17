# Stop and ask

Stopping is not failing. For each case below, stop that line of work, send the developer one message, and continue with other work if there is any. Make every question answerable in a word.

## Contents

- When to stop and ask
- Human steps: what only a person can do
- Release stops: errors that are never retried
- How to write the message

## When to stop and ask

| Situation | What to do |
|---|---|
| A human step is needed (next section) | name the step and the one action needed; never simulate or skip it |
| A gate looks wrong or blocks: a lint rule, a limit, a threshold, a tolerance, a baseline, an audit finding | do not edit the gate; send the gate note (gate, file and line, message, why it looks wrong, the smallest change); quality-gates' permissions prompt on gate files anyway |
| A change would touch a gated path (`quality-gates.json` `gatedPaths`) other than by an intended, explained change | ask; an agreed change goes in one commit with a `Gate-Change:` trailer |
| The requirement is contradicted, ambiguous or silent about something a user would see | quote the requirement lines, give the options with a recommended default, keep working (spec-traceability) |
| Two of the project's instructions disagree | follow the one that owns the topic, say so in the report, and name the other so it gets fixed |
| Irreversible or outward-facing actions: a store upload (`eas submit`, Transporter, the Play API), submitting for review, creating or changing App Store Connect or Play Console records (in-app products, age ratings, tester groups, the Data safety form), publishing an OTA update to a production channel, pushing branches or tags, force-pushing or rewriting pushed history, deleting files, data, simulators or emulators this session did not create, sending anything to a third party, spending money | ask first, unless the developer asked for exactly this action in this session; submit for review only after the developer says "submit" |
| A release stop (below) | stop, do not retry, do not switch signing methods or credentials; one message with the step and the exact error line |
| Anything that would read, print, copy, move or commit a secret: an App Store Connect API key (`.p8`), a Play service-account JSON, a keystore or its passwords, a certificate or provisioning profile, a token, an `.env` file | never; if a task seems to need it, ask |
| A new dependency outside the documented procedure, a package the dependency policy bans, a held-back major version, a release-age exception | ask, unless the dependency procedure covers it exactly (dependency-management) |
| An open product decision becomes blocking | use the documented default and say so; ask when the default no longer works |
| A human check: trying a build on a phone, reviewing translated drafts, listening to sounds, a VoiceOver or TalkBack spot check | not a stop: never stop or wait for it; list it under "Human checks (not blocking)" in the report and keep working |
| A setting that cannot be turned off again once on (for example Family Sharing for an in-app purchase) | never turn it on without the developer's explicit word for that setting |
| A gate still fails after the agreed number of attempts (a Stop hook's continuations, a retry budget) | report the failing gate and what was tried, instead of working around it |

## Human steps: what only a person can do

These need a person's account, signature, money or judgement. Name the step in plain words and how long it takes. An app that keeps its own numbered list (for example `docs/human-steps.md` with ids) names the id too; the list is the app's, not this skill's.

Once, per developer or team:

| Step | Why only a person |
|---|---|
| Join the Apple Developer Program and accept its agreements; for paid apps or in-app purchases, the Paid Apps agreement with tax and banking | a legal agreement and payment details |
| Create the Google Play developer account and verify it; for paid apps, the payments profile | identity verification and payment details |
| Declare EU trader status (App Store Connect and Play Console) for apps sold in the EU | a legal declaration |
| Create the store API credentials the release step uses: an App Store Connect API key, a Google Play service account with release permission, or EAS credentials (`eas credentials`) | the keys are secrets and grant release rights; the agent never handles the files |
| Install Xcode and accept its licence (`sudo xcodebuild -license`), install Android Studio's SDK and accept its licences | needs an administrator password or interactive acceptance |
| Approve the agent's permission prompts when hooks or permission rules are added | the agent cannot approve its own permissions |
| Install TestFlight on an iPhone and join the app's internal testers group in App Store Connect; on an Android phone, join the Play internal-testing track as a tester (opt-in link, same Google account) | the on-device human checks of every report assume a tester exists; only the person can sign in on their own phone |

Per app:

| Step | Why only a person |
|---|---|
| Confirm the app name and the bundle identifier / application id | the name must be unique in the stores and the id can never change after the first upload |
| Create the app record in App Store Connect and the app in Play Console | no API creates them |
| Fill in the App Privacy answers (App Store) and the Data safety form (Play) with the prepared answers (privacy-and-store-declarations) | a legal declaration in the developer's name |
| Give the privacy-policy URL and the support address | they belong to the developer |
| Create or check in-app products and subscriptions, and their prices (in-app-purchases) | money and tax decisions |
| Create the ad accounts, ad units and consent messages (admob-ads-and-consent) | an account and a published legal message |
| Approve the store listing: texts, screenshots, age-rating answers | the developer's public voice |
| Local lane only, as a fallback: sign in once in Xcode > Settings > Accounts when the first archive with the App Store Connect API key cannot create the development certificate (ios-release-testflight holds the details) | an interactive Apple ID sign-in, often with two-factor authentication |

Per release:

| Step | Why only a person |
|---|---|
| Say "ship" or "don't ship" for the tested build | the release tag and the submission leave the machine |
| Submit for review (or tell the agent "submit"); choose manual or automatic release after approval | outward-facing and irreversible |
| Accept a new store agreement reported as blocking | a legal agreement |
| Answer App Review or Play policy messages | a conversation in the developer's name |

## Release stops: errors that are never retried

Stop, do not retry, do not switch signing methods or credentials, and send one message with the step and the exact error line:

| Platform | Error | Human step |
|---|---|---|
| iOS (local signing) | `errSecInternalComponent` from `codesign`: the login keychain is locked | unlock the keychain at the desktop session (`security unlock-keychain`) |
| iOS | an agreement error (`agreement`, `PLA Update available`, a `FORBIDDEN` that mentions an agreement) | accept the agreement in App Store Connect, then rerun from the failed step |
| iOS | HTTP 401 `NOT_AUTHORIZED` (wrong key or issuer id, revoked key, clock skew) or 403 `FORBIDDEN_ERROR` (key role too low) | check or recreate the API key with the right role |
| iOS | no app record for the bundle identifier | create the app record |
| iOS | a build processing state `INVALID` or `FAILED` | forward Apple's email; fix, then rebuild with a new build number |
| Android | Play API `403 The caller does not have permission` | give the service account release permission for the app in Play Console (Users and permissions) |
| Android | `Package not found` for the application id | create the app in Play Console with that application id |
| Android | a version code that has already been used | never reuse it: rebuild with the next build number (EAS remote versioning increments it) |
| Android | `Only releases with status draft may be created on draft app` | the app is still a draft in Play Console: submit as a draft release, or finish the store listing and setup tasks first |
| Both (EAS) | `eas submit` or `eas build` reports missing or invalid credentials | the developer fixes the credentials (`eas credentials`); the agent never uploads key files itself |

Retries of these lock accounts, burn build numbers or hide the real cause. The release skills (eas-build-and-submit, ios-release-testflight, android-release-play) hold the full failure tables; this list is what stops the agent.

## How to write the message

- One message, one request, answerable in a word, with the default that applies until the developer answers: "Please create the app for Tasks in Play Console with the application id com.example.tasks (about 5 minutes). Until then I keep working on the shared lists."
- Name how long the step takes, and the app's own step id when it keeps a list.
- For a release stop: the platform and step, the exact error line, the one action needed (`templates/reports/release-stop.md`).
- For a requirement question: quote the requirement lines, give the options, and say which default you are using meanwhile (`templates/reports/request.md`). Print the lines from the requirement source (spec-traceability), never from memory.
- Filling `templates/reports/request.md`: for a human step delete the three bullet lines; for a requirement question write "Please answer A or B", and keep the quoted lines and the options.
- Before sending, save the message under `reports/` (git-ignored) and run `node ${CLAUDE_SKILL_DIR}/scripts/check-report.mjs . --report reports/<message>.md --kind request`; `examples/requests.md` shows one of each kind.
- Then keep working on whatever does not depend on the answer.
