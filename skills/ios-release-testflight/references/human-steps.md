# Human steps and the release checklist

Everything only the developer can do (a password, sudo, an Apple login, a legal choice, a judgement), named the way the agent asks for it, then the checklist before and after a release. An app that keeps its own numbered list of human steps names its ids too; the list is the app's.

## Contents

- How to ask
- Once per developer or team
- Per app (and per uploaded variant)
- Per release
- Release checklist

## How to ask

One message, one request answerable in a word or one action: the step in plain words, the exact click path or command, how long it takes, why it blocks, and what the agent does meanwhile. Then continue with work that does not depend on the answer. Never retry a human stop. `git-commits-and-reporting` checks the message (`check-report --kind request`).

## Once per developer or team

- **Developer program and agreements.** Keep the Apple Developer Program active and accept the current Program License Agreement (developer.apple.com). For paid apps or in-app purchases, accept the **Paid Apps Agreement** in App Store Connect > Business and complete tax and banking.
- **EU trader status.** Declare Digital Services Act trader status in App Store Connect when the app is offered in the EU; apps without it are removed from EU storefronts.
- **API key** (local lane). Create a **team** App Store Connect API key with the **Admin** role, save the `.p8` as `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8` with `chmod 600`, and export `ASC_KEY_ID`, `ASC_ISSUER_ID` and `APPLE_TEAM_ID` in the shell profile. EAS lane: `eas credentials` (the developer runs it; `eas-build-and-submit`).
- **Xcode licence.** Install the pinned Xcode as `/Applications/Xcode-<version>.app` and accept its licence with sudo (about once a year when a new Xcode is required).
- **TestFlight.** Install TestFlight on an iPhone and sign in with an Apple Account that is an internal tester of the team.
- **Agent permissions.** Approve the agent's permission prompts when it adds hooks or deny rules to `.claude/settings.json`.
- **Fallback only:** if the first API-key archive cannot create the Apple Development certificate, sign in once in Xcode > Settings > Accounts.
- **Only when it happens:** unlock the login keychain (`errSecInternalComponent`).

## Per app (and per uploaded variant)

- **Name and bundle id.** Confirm the app name (unique on the App Store) and the production bundle id (`contracts/ios-release.json` `appId`, reverse-DNS, all lowercase is safest, valid on Android too); it can never change after the first upload.
- **App record and internal tester group.** App Store Connect > Apps > + > New App (iOS, name, primary language, bundle id, SKU). The public API cannot create apps. In the same visit: the app > TestFlight > Internal Testing > +, a group with automatic distribution, the developer added. TestFlight shows a build only to testers in a group that has it. A preview build (`<appId>.preview`) needs its own record ("Tasks Preview"). About 3 minutes each.
- **App Privacy answers** (web) from the prepared answers of `privacy-and-store-declarations`, and the privacy-policy URL and support address that go into the app config. Until then the template values (`example.com`, `support@example.com`) fail the gate as `[ship-placeholder]`: the expected result, never something to type over.
- **Products and ad accounts.** In-app products and prices (`in-app-purchases`; the first one is submitted with an app version); the AdMob app and its units (`admob-ads-and-consent`), whose ids replace the template ids.
- **Store listing.** Texts, screenshots, age-rating answers.

## Per release

- **"Ship" or "don't ship"** for the tested production build (install it from TestFlight).
- **Submit for review:** one click in App Store Connect, or the developer tells the agent "submit". The agent never submits without that message.
- **Accept a new agreement** the agent reports as blocking.
- **Answer App Review messages** (Resolution Center); choose manual or automatic release after approval.
- **Judgement checks that never block** (listed under "Human steps (not blocking)"): a translation review of new strings, a play-test or VoiceOver spot check, a look at a new screen.

## Release checklist

Before `npm run release:ios -- --variant production` (or the EAS production build):

- [ ] `npm run verify` is green on this commit.
- [ ] E2E flows and the screenshot matrix are green on a preview build of **this** commit, and the screenshot diffs were reviewed (when the repo has them: `e2e-maestro`).
- [ ] The version in `app.config.ts` is correct and higher than the last approved version.
- [ ] `node <skill>/scripts/check-release-setup.mjs .` prints `RESULT: PASS` (local lane): the bundle id, ad ids and links are the real ones, no `[ship-placeholder]` line.
- [ ] With ads: the SKAdNetwork list was refreshed (`admob-ads-and-consent`).
- [ ] The agreements are current; the app record exists for the variant; first release: products exist and are attached to the version.
- [ ] The report lists the non-blocking human steps; none of them holds the release.
- [ ] Other skills' gates, when the app uses them: a pending schema version (run-migration's `check-migration`) is named in the ask, because a TestFlight build makes it permanent, and recorded with run-migration's `record-shipped --build <n>` after the upload; design-review-workflow's `check-signoff.mjs . --version <x.y.z>` prints `RESULT: PASS`; privacy-and-store-declarations' `audit-app-bundle.mjs . --app <Payload/App.app> --variant production` passes on the same `.app` the gate read; with verified links, deep-links-and-universal-links' `check-deep-links --release` passes, and on the local lane the App ID has the Associated Domains capability (production only; EAS syncs it from `ios.associatedDomains`).
- [ ] With `scripts/i18n/review-sheet.ts` (i18n-strings-and-catalogs), the preflight of a production build runs it and its `REVIEW PENDING (not blocking): ...` line reaches the report as a human step (on EAS run `node scripts/i18n/review-sheet.ts --release` by hand).

After the upload:

- [ ] The store-artifact gate passed (`check-store-artifact.mjs`, no `--rehearsal`); validation and upload returned success.
- [ ] Processing reached `VALID`, and What to Test is set.
- [ ] The annotated upload tag exists (pushed only with the developer's word); the developer has the report.
- [ ] On "ship": the release tag is set; the developer submits (or tells the agent "submit"); the store listing is complete.
