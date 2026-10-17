# Tracks and staged rollout

Where an uploaded bundle goes, how it reaches production users, and how a bad release is stopped.

## Contents

- The tracks
- Uploads go to a testing track
- Promotion to production is a staged rollout
- Halting a release
- Draft apps and the first release
- New personal developer accounts
- Review and timing

## The tracks

| Track | Who gets it | Review | Use |
|---|---|---|---|
| `internal` | up to 100 testers by e-mail list, within minutes | none (Play scans the bundle) | every upload of this library's tooling by default |
| `alpha` (closed testing) | testers in lists or Google Groups | yes | wider testing, the closed test a new personal account must run |
| `beta` (open testing) | anyone who opts in from the store page | yes | public testing |
| `production` | everyone, or a fraction during a staged rollout | yes | users |

Custom closed tracks and form-factor tracks (`wear:production`) exist too; the contract's
`uploadTrack` takes the three testing names. Facts verified on 2026-10-14 against the Play Developer
API `edits.tracks` reference; tester limits are Play Console's and change: check them there.

## Uploads go to a testing track

The contract's `uploadTrack` (default `internal`) is the only place an upload goes, on both lanes:
`submit.production.android.track` in `eas.json` must equal it (`check-play-release-setup.mjs` rule
`lane`), and the local tooling has no option to upload elsewhere. Why: an upload that lands on
production reaches users before anyone installed it from the store, and an upload cannot be undone.

## Promotion to production is a staged rollout

A versionCode reaches production only after it was uploaded to a testing track (it has an upload tag)
and a person installed it from there. Then it is promoted in steps, the contract's `rollout`
fractions (default `[0.05, 0.2, 0.5, 1]`):

| Release status | Meaning | API body |
|---|---|---|
| `inProgress` | served to `userFraction` of eligible users (0 < fraction < 1) | `{ "versionCodes": ["15"], "status": "inProgress", "userFraction": 0.05 }` |
| `completed` | served to everyone (unless a newer release qualifies) | `{ "versionCodes": ["15"], "status": "completed" }` |
| `halted` | no longer served to new users; installs stay | `{ "versionCodes": ["15"], "status": "halted", "userFraction": 0.05 }` |
| `draft` | not served | `{ "versionCodes": ["15"], "status": "draft" }` |

Local lane, each step with the developer's word in this session:

```sh
npm run release:android -- rollout --version-code 15 --fraction 0.05
# after the crash-free rate and the reviews look right (a day or more):
npm run release:android -- rollout --version-code 15 --fraction 0.2
npm run release:android -- rollout --version-code 15 --fraction 1   # completed
```

`rollout` refuses a fraction that is not a contract step and a versionCode without an upload tag
(`rolloutStepProblems`, `promotionProblems`). On the EAS lane the developer promotes in Play Console
(Test and release, Production, Create new release from the testing track's build, set the rollout
percentage), because `eas submit` uploads a binary and never promotes one.

Before each raise, read the crash-free rate (crash-reporting-and-observability; Play Console's
Android vitals) and the new reviews. A step is a decision for a person, not a timer.

`countryTargeting` exists only on `inProgress` production releases; this library does not use it.
`inAppUpdatePriority` (0 to 5) cannot change once a release rolled out; set it on the first step if
the app uses in-app updates.

## Halting a release

When a staged release crashes or misbehaves:

```sh
npm run release:android -- halt --version-code 15 --fraction 0.05
```

New users stop getting it; those who installed keep it. Then fix, build a new versionCode, take it
through the testing track again and start a new staged rollout. Never rebuild the halted versionCode:
the number is spent. If the problem is in JavaScript only and the app ships OTA updates, ota-updates
owns the faster path (a rollback or a fix to the production channel), still with the developer's word.

## Draft apps and the first release

A new app stays a draft in Play Console until its first release is set up there. While it is a draft,
the API refuses any release that is not a draft: `Only releases with status draft may be created on
draft app` (stop reason `draft-app`). Then:

- upload with `releaseStatus: "draft"` (EAS: the submit profile's `releaseStatus`; local:
  `upload --draft-app`), and the developer rolls the release out in Play Console; or
- the developer finishes the store listing and the setup tasks first.

Whether the API may make the very first upload of a new app is not something to find out by retrying:
the default is that a person uploads the first bundle in Play Console (human-steps.md), which also
registers the upload key, and the tooling uploads every later one.

## New personal developer accounts

Google requires personal developer accounts created after November 2023 to run a closed test with a
minimum number of testers who stay opted in for a minimum number of days before production access is
granted (12 testers for 14 days at the time of writing; unverified by fetch on 2026-10-14, check the
Play Console dashboard). Plan the `alpha` track for it; it is a human step and never blocks the
build, the gate or internal testing.

## Review and timing

Closed, open and production releases go through review (hours to days); internal testing does not.
Changes can be held with "Managed publishing" in Play Console so reviewed releases go live only when
the developer publishes them. `changesNotSentForReview` in `eas.json` keeps EAS submissions out of
review until someone sends them from the Console; on the local lane `upload`, `rollout` and `halt`
take `--changes-not-sent-for-review`, used only after the `changes-not-sent-for-review` stop and the
developer's choice (play-api.md).
