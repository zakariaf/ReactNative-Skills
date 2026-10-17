# Writing to the reviewer: evidence after every slice and release

The reviewer, a teammate, a lead or a solo developer coming back tomorrow, reads this message first and the code afterwards, if at all. Every finished slice and every release ends with an evidence message built from the evidence files, in the shape below. `scripts/check-report.mjs` checks it before it is sent.

## Contents

- The rules
- The message shape
- Slice form and release form
- UI changes: the approved design baseline
- Changes that are easy to miss: goldens, baselines and texts
- Human checks (not blocking)
- What is not evidence
- Where each number comes from
- Honest limits
- Plain words
- contracts/reporting.json

## The rules

1. **Lead with the outcome in one sentence, in users' words:** "A task title you were typing is still there after the app is closed or killed." The first line has three limits, and `check-report` names each one it breaks with the numbers: at most 240 characters ("first line is 255 characters, the limit is 240"), at most 2 sentences ("3 sentences, at most 2"), and it ends in `.` or `!` ("does not end in . or !"). It is a sentence, never a heading, list item, code fence, the Evidence line or a request. A longer outcome is split: the first sentence says what now works, the next lines give the rest (rule `outcome-first`).
2. **Name things the way the app's requirements do:** screens by their name (Tasks, Settings), features and requirement IDs as the spec or tracker writes them (`TASK-12`).
3. **Numbers come from evidence files**, never from memory; name the file on the line (rules `report-source`, `tests-count`, `checks-missing`).
4. **At most one request per message**, answerable in a word, with the default that applies until then: "Please say "ship" when build 14 may go to review. Until then it stays in testing and I keep working on the shared lists." (rules `too-many-requests`, `request-default`).
5. **Point at no more than five things to look at**, and say where (a screenshot file, a gallery row, a TestFlight or internal-testing build) (rule `look-at-limit`).
6. **Be honest about limits:** an `Evidence:` line, "What changed for users" and "Not tested or not verified" are always there (rules `evidence-line`, `section-missing`).
7. **Keep technical detail out of the first lines.** Stack traces, commands, file paths and code go after a "Details" line at the end, or into the commit messages (rule `technical-detail-early`).
8. **List the human checks, never wait for them** (rule `human-checks-listed`), **never cite what is not evidence** (rule `non-evidence-cited`), and leave no placeholder (rule `placeholder-left`).

## The message shape

```text
<one sentence: what now works, in users' words>

<optional: one request with its default>

Evidence: <app or area> <slice | release X.Y.Z> on <YYYY-MM-DD>, commit <sha>

Checks
- Types, lint, format: pass
- Tests: <passed>/<total> pass (unit <n>, golden <n>), random seed <seed>
- Coverage: lines <x>% (gate 90), logic folders <x>% (gate 95)          reports/coverage/coverage-summary.json
- Mutation (release): <score>% (break 75), survivors explained below    reports/stryker/mutation.json
- End-to-end (release): iOS <p>/<t>, Android <p>/<t> flows pass, quarantined: <none | list>   reports/e2e/ios/junit.xml, reports/e2e/android/junit.xml
- <any check the app adds in contracts/reporting.json, with its file>

What changed for users
- <one line per behaviour, in the requirement's words>

Please look at (at most 5)
- <screenshot or gallery row>, because <reason>

Goldens and baselines changed on purpose
- <file or folder>: <what changed and why> (Gate-Change trailer in <sha>)

Texts changed in every locale
- <key or place> (<every locale>): <the new source text>; which drafts go to a native-language review

Human checks (not blocking)
- On-device check: <what to try, on which build>, <still open | done on YYYY-MM-DD>
- Native-language review of changed texts: <the drafts, or "none pending">

Not tested or not verified
- <honest list: device-only behaviour, store purchases, a rehearsal, anything skipped>

Details
<commands, file lists, red runs, anything technical>
```

`templates/reports/evidence-slice.md` and `templates/reports/evidence-release.md` hold this shape with `__PLACEHOLDERS__`; the examples show both filled in. Headings are matched by their start, so "Please look at (at most 5)" may carry a short note after the name.

## Slice form and release form

| Part | Slice | Release |
|---|---|---|
| Outcome sentence | required | required |
| Evidence line | required (`slice` in it) | required (`release X.Y.Z` in it) |
| Checks: Types, lint, format; Tests | required | required |
| Checks: Coverage, Mutation, End-to-end | when the slice ran them, each with its file | all required (default `releaseChecks`), each with its file |
| Checks: Design match | when the slice changed a screen and the app keeps design baselines | required for every changed screen when the app keeps them |
| What changed for users | required | required |
| Please look at | when there is something to look at (at most 5) | the screenshots that changed (at most 5) |
| Goldens and baselines changed on purpose | when any changed | required ("none" when none) |
| Texts changed in every locale | when any changed | when any changed |
| Human checks (not blocking) | required | required |
| Not tested or not verified | required | required |

The one request of a release report is the reviewer's "ship", because the release tag and the submission for review leave the machine; it never waits for a human check. `check-report.mjs` reads the form from the Evidence line (`release` in it) unless `--kind` says otherwise.

For a slice, put the red run's assertion lines (Expected / Received) under Details: they are the evidence that the test came first (tdd-workflow).

## UI changes: the approved design baseline

When the app keeps approved design baselines (design-visual-parity), a slice or release that changed a screen adds one Checks line and names where the result is recorded:

```text
- Design match: Tasks and Settings match their approved design baselines in en and ar, light and dark (0 waivers)   reports/parity/summary.json
```

`check-report.mjs` treats "Design match" like the other measured lines: it must name the file the result came from. A screen that does not match yet is not done; it goes under "Not tested or not verified" with the reason, never under Checks. To make the line required, add `"Design match"` to `sliceChecks` or `releaseChecks` in `contracts/reporting.json`.

Every waiver behind a Design match line (a screen region accepted as different for now) is also listed under "Not tested or not verified", one line each with its reason, so "(2 waivers)" never hides what was not matched. A changed waiver or design reference file goes in "Goldens and baselines changed on purpose" with its Gate-Change commit when it is in `gatedPaths`, or with design-visual-parity's change id when that skill logs reference changes instead. design-visual-parity owns those files and their log.

## Changes that are easy to miss: goldens, baselines and texts

Two kinds of change are deliberate but easy for the reviewer to miss, so each gets its own block when the work made one. Paste the blocks from `templates/reports/report-blocks.md` above "Human checks"; `examples/baseline-and-text-changes.md` is a complete report with both. `check-report.mjs` checks every line of each block that is present.

**Goldens and baselines changed on purpose.** A golden snapshot, an image snapshot, a golden vector, a Maestro or performance baseline, a frozen database fixture: any file in `gatedPaths` that records an expected result. One line per file or folder: its path, what it now shows in plain words, why, and `(Gate-Change trailer in <sha>)` naming the commit that changed it (rule `baseline-change-trailer`). A release report always has the block ("- none" when nothing changed).

**Texts changed in every locale.** A user-visible text that changed is reported once per text, not per language: the message key or the place it shows, every locale code of the app (`en, ar`), the new text in the source locale, and which drafts go to a native-language review (rule `translations-listed`). The locales come from `contracts/reporting.json` `locales`, else the file names of `src/i18n/catalogs/*.json` (i18n-strings-and-catalogs). With a single locale, no review is named. Name the drafts on the review line of "Human checks" (never "none pending" while texts changed).

## Human checks (not blocking)

Some checks only a person can do: trying the build on a real phone, reading a translated draft, listening to a sound. Every slice and release report lists them, one line each, saying what is pending or "none pending". No gate and no step of the work waits for them, and the line never says that something waits for them ("the release waits for it", "blocking") (rule `human-checks-listed`). The default list, overridable in `contracts/reporting.json` `humanChecks`:

| Check | A line of the block must match | Applies |
|---|---|---|
| the on-device check | `device`, `phone`, `tablet`, `hands-on`, `TestFlight` or `internal test` | always |
| the native-language review of changed texts | `review` | when the app has two or more locales |

## What is not evidence

A release gate run with `--rehearsal` (a keyless dry run that prints `REHEARSAL: not a release gate`), any `--dry-run`, and a result that fails only on a ship placeholder (an unfilled store id or support address) prove nothing about a release. Mention such a run only under "Not tested or not verified", "Details" or "Human checks"; a Checks line or any other line that cites it fails rule `non-evidence-cited`. The markers default to `rehearsal`, `--rehearsal`, `dry run`, `dry-run`, `--dry-run` and `ship-placeholder` (`contracts/reporting.json` `nonEvidenceMarkers`).

A build handed over before the store credentials exist ends with a slice report, never a release report: the rehearsal goes under "Not tested or not verified", and the release report follows the first real upload.

## Where each number comes from

| Line | Source file |
|---|---|
| Tests | passed/total and the random seed from the Jest summary of `npm run test:coverage` (`jest --ci --coverage --randomize`). That summary is one combined line for every Jest project, so take the golden count from `npm run test:golden` (its "Tests: <n> passed" line) and write unit = total minus golden |
| Coverage | `reports/coverage/coverage-summary.json` (the gates: 90 % global, 95 % for `src/core/` and `src/data/`, from `quality-gates.json`) |
| Mutation | `reports/stryker/mutation.json` (the break threshold, 75, from `stryker.config.json`) |
| End-to-end | the JUnit file of each platform run, one per platform, for example `reports/e2e/ios/junit.xml` and `reports/e2e/android/junit.xml` (e2e-maestro names the run folders); a release line names both |
| Screenshots | the screenshot run's summary file (e2e-maestro) |
| Design match | the parity run's summary (design-visual-parity) |
| Performance | the perf report of performance-budgets |

Never round up, never type a number from memory, never call a check that did not run "pass". A check that was not run goes under "Not tested or not verified".

**What the checker can and cannot prove.** `report-source` (and the file half of `baseline-change-trailer`) passes a line that names a path: at least one folder and then a file with an extension (`reports/e2e/junit.xml`) or a folder ending in `/` (`.maestro/baselines/`). A ratio such as `14/14`, `90/95` or `light/dark` is not a path, so "End-to-end: iOS 14/14, Android 14/14 flows pass" without its file fails. The checker does not open the file or compare the number with it, and a made-up path passes; naming the real file is what lets the reviewer check the number in one step, so copy the number and the path together from the run. `tests-count` reads every `<passed>/<total>` on the Tests line ("unit 190/190, golden 20/22" fails); keep the one shape `Tests: <passed>/<total> pass (unit <n>, golden <n>), random seed <seed>`.

## Honest limits

What the agent cannot verify, and says so:

- Sound, haptics and 120 Hz smoothness need a real phone; the simulator and the emulator only prove the app asked for them.
- Purchases beyond the local test harness need TestFlight sandbox testers (iOS) and license testers on a Play internal-testing build (Android).
- VoiceOver and TalkBack need a person's spot check; automated checks cover labels and roles, not the experience.
- Translated drafts need a native speaker's review; the agent writes natural drafts and lists them.
- Real ads (live ad unit ids) are never shown in test builds.
- Push notifications need a real device and the production credentials.
- Anything skipped, quarantined or flaky in this run.

## Plain words

| Instead of | Write |
|---|---|
| "Implemented an idempotent upsert in the draft repository" | "Saving the same draft twice no longer creates two tasks." |
| "Fixed an RTL layout bug in the task row" | "In Arabic, the due date now sits at the start of the row, on the right." |
| "All tests green" | "Tests: 214/214 pass (unit 192, golden 22), random seed 48213" |
| "Reminders work" | "A weekly reminder now fires at the chosen time on both platforms, also after a restart (TASK-40)." |

## contracts/reporting.json

Optional; without it the defaults above apply. Keys (all optional; `templates/contracts/reporting.json` and its schema):

| Key | Default | Meaning |
|---|---|---|
| `locales` | the file names of `src/i18n/catalogs/*.json` | the app's locale codes for the texts block |
| `sliceChecks` | `[]` | Checks lines every slice needs (each must name its file) |
| `releaseChecks` | `["Coverage", "Mutation", "End-to-end"]` | Checks lines a release also needs (each must name its file) |
| `humanChecks` | the two checks above | `{ name, match, example?, minLocales? }`: one line of the block must match `match` (case-insensitive) |
| `nonEvidenceMarkers` | the list above | words that mark a result which is not evidence |

The contract lives at `<contractsDir>/reporting.json` (default `contracts/`, moved by `rn-skills.config.json` `contractsDir`; `src/i18n` moves with `srcDir`). A malformed file is bad input (exit 2), never a silent default.
