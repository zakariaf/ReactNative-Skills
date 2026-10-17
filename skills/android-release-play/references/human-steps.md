# Human steps for Google Play

Everything only a person can do for an Android release, why, the click path, and what the agent does
meanwhile. None of these blocks the build, the gate or the rehearsal; ask for every missing one in
one message (git-commits-and-reporting's request form), each with its default. Play Console menus
move; the paths below are the 2026 layout, and the names are what to search for when they move.

## Contents

- Once per developer: the account and EU trader status
- Once per app
- The order
- What comes back, and what never goes into the chat
- The human checks of every release

## Once per developer: the account and EU trader status

**Google Play developer account.** play.google.com/console/signup: a personal or an organization
account, the one-time registration fee, Google's identity verification (an organization also needs a
D-U-N-S number). A payments profile (Setup, Payments profile) before paid products. New personal
accounts must run a closed test before production access (tracks-and-rollout.md); plan it early.

**EU trader status (Digital Services Act).** Play Console, Settings, Developer account, Account
details (search "trader status"): declare whether the account is a trader (sells or earns from apps,
including ads and purchases) or not. A trader's address, phone and e-mail are verified and shown on
the store listing in the EU; an account without a declaration has its apps removed from Play in the
EU (Play Console Help, "Trader status"; read, not reproduced, on 2026-10-14). Only
the account holder can answer, because it is a legal statement about the business
(git-commits-and-reporting lists it among the stop-and-ask steps). The agent never guesses it.

## Once per app

| Step | Click path | Meanwhile |
|---|---|---|
| Create the app | Play Console, Home, Create app: name, default language, app or game, free or paid; accept the declarations. The application id is fixed by the first upload and can never change | the agent builds and rehearses |
| Upload key | EAS lane: nothing (EAS generates it on the first production build). Local lane: say "go" and the agent generates `~/.android-keys/<applicationId>-upload.jks` (signing-and-keys.md), or put the team's own key there | the gate fails `signing` until the fingerprint is registered in the contract |
| Service account | Google Cloud console (a project the team owns): APIs and services, Library, "Google Play Android Developer API", Enable; IAM and admin, Service accounts, Create (no project roles); Keys, Add key, JSON. EAS lane: upload the JSON in `eas credentials` (Android, Google Service Account) and delete the download. Local lane: save it as `~/.android-keys/<applicationId>-play-service-account.json` and `chmod 600` it. Then Play Console, Users and permissions, Invite new users: the service account's e-mail, this app only, "Release apps to testing tracks" (and "Release to production" only if the tooling should promote) and "View app information" | uploads wait; build and gate do not |
| App content | Play Console, the app, Policy and programs, App content: privacy policy URL, ads, app access (a test login if needed), content rating questionnaire, target audience, Data safety (the answers privacy-and-store-declarations prints), advertising ID, permissions declarations the contract names (`playDeclaration`), government, financial and health features, account deletion URL if the app has accounts | the agent prints the Data safety input and the declarations list |
| Main store listing | Play Console, the app, Grow users, Store presence, Main store listing: app name (30 characters), short description (80), full description (4,000); the app icon 512 x 512 px 32-bit PNG (up to 1 MB); the feature graphic 1024 x 500 px JPEG or 24-bit PNG without alpha; at least 2 phone screenshots (JPEG or 24-bit PNG, each side 320 to 3,840 px, the long side at most twice the short), and 7-inch and 10-inch tablet screenshots when the app supports tablets; then Store settings: category, contact e-mail (and website, phone), and the privacy policy URL. Per language the app ships (`en` and `ar` in the examples). Sizes from Play Console Help ("Add preview assets"), read on 2026-10-14 | the agent drafts the texts in each locale for the developer to approve, and names the icon source: the 512 px icon comes from the app icon (icons-app-icon-and-splash); screenshots from the E2E screenshot flow (e2e-maestro). A person uploads them and presses Save |
| AdMob Android app (apps with ads) | admob.google.com, Apps, Add app, Android; then ad units. Send the app id and unit ids | builds keep Google's sample ids outside production; a production bundle with them fails `ship-placeholder` |
| Products (apps with purchases) | Play Console, Monetize with Play, Products: after a build with the BILLING permission was uploaded | in-app-purchases |
| Testers and the first upload | Test and release, Testing, Internal testing, Testers: an e-mail list; Setup, License testing: the same accounts. Then Internal testing, Create new release: upload the gated bundle the agent kept (`build/release-android/app-release.aab` or the local lane's `android/app/build/outputs/bundle/release/app-release.aab`), notes, Save and publish | the agent keeps the gated bundle and its stamp |

After the first upload, compare Play Console's App integrity, Upload key certificate SHA-256 with the
contract's `uploadCertificateSha256` once.

## The order

1. The account and its EU trader status, then create the app, the service account and (with ads)
   the AdMob app, in any order; the go for the upload key (local lane).
2. The agent builds, gates (with `--stamp`) and keeps the bundle.
3. The main store listing and App content, then the first upload by a person (it also takes the
   app out of draft once the release is rolled out; the Console lists any setup task still open).
4. Products after the first upload with BILLING.
5. From then on the tooling uploads each gated build to the testing track; promotion to production
   is a staged rollout, each step with the developer's word.

## What comes back, and what never goes into the chat

- In the chat: "done" for each step, the AdMob ids, the privacy policy URL and support address, the
  trader status chosen (yes or no, never the verified documents), the upload certificate
  fingerprint if Play Console shows a different one.
- Never in the chat: the service-account JSON, a keystore, any password. They go to EAS
  (`eas credentials`) or to `~/.android-keys/` and `~/.gradle/gradle.properties`, and nothing reads
  them except EAS, Gradle (the key) and `play-credentials.ts` (the JSON, into memory).

## The human checks of every release

Listed in every Android release report, never waited for: install from the testing track on a real
phone; the purchase test as a license tester (buy, cancel, pending, restore after reinstall); a
TalkBack pass; the app's locales including the RTL one; and before each staged rollout raise, the
crash-free rate and the new reviews.
