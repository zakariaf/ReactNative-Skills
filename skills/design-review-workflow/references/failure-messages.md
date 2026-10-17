# Failure messages

Every rule id the scripts print, what it means, the usual cause and the fix. Each `FAIL` line already
names the file, the line and a fix; this page adds the why.

## Contents

- check-review-plan.mjs
- new-review.mjs
- check-review.mjs
- check-signoff.mjs
- Exit 2 (ERROR lines)
- SKIP lines
- Limits of the heuristics

## check-review-plan.mjs

| Rule | Meaning | Usual cause | Fix |
|---|---|---|---|
| `plan-invalid` | the plan's shape is wrong; no other rule runs | a typo in a key, `version` not 1, a device without `model` | follow `templates/contracts/design-review.json` |
| `plan-screens` | the sweep does not follow the screen contract | an excluded screen the contract dropped, an exclusion without a reason, an invariant on an unswept screen | exclude only screens no person sees, with why |
| `plan-open` | a state or a combination cannot be opened reproducibly | a new state without an `open` entry; `lang`/`theme`/`motion` in a state link; a parameter or value the debug-link contract lacks; the contract without `lang` for every plan locale, `theme` with `system` or `motion` with `still` (the combination link sets them) | add the link; drop combination parameters; declare the parameter and its values first (debug-menu-and-test-hooks) |
| `plan-themes` | the plan's themes differ from what `userInterfaceStyle` shows | `automatic` with only light swept; dark swept in a light-only app | sweep exactly the themes a person can see |
| `plan-locales` | a direction is missing or wrong, or the languages cannot be read | no rtl locale while the app ships Arabic; a locale the app does not ship; `LANGUAGES` built from other constants | one ltr and one rtl locale from `languages.ts`; keep `LANGUAGES` a plain literal list |
| `plan-text-sizes` | `default`/`largest` missing, wrong values, or not on the right devices | `largest` set to a size the layout survives; `largest` not on a smallest phone | the fixed values; `largest` on every smallest phone |
| `plan-devices` | a device class, name or orientation is missing or wrong | no tablet with `supportsTablet`; the iPad or the Android tablet only in portrait (both rotate whatever `orientation` says); `"name": "booted"`; two devices sharing a simulator | add the device with its own `<project>-<purpose>` name, large screens in landscape |
| `plan-motion` | a declared moment is neither recorded nor explained | a new moment in the catalog | add it to `record`, or to `notRecorded` with why |
| `plan-build` | the sweep is not on the preview build | `development`; `production`, which strips the debug link every combination is set through | `preview`; the store build is judged in the on-device pass |
| `plan-device-pass` | a core step, the order or the hardware is wrong | a step deleted because "it does not apply"; a destructive step early; no real Android phone | keep every core step, destructive last; one real phone per platform |

## new-review.mjs

| Rule | Meaning | Fix |
|---|---|---|
| `plan-invalid` | the plan cannot be read, so no record is written | run `check-review-plan.mjs` and fix the plan |

## check-review.mjs

| Rule | Meaning | Usual cause | Fix |
|---|---|---|---|
| `review-record` | the record's shape or build facts are wrong | a hand edit; `build.verify` not `pass`; another variant than the plan's; a `fixRounds` list | keep the format; run the gates before the review |
| `review-stale` | the plan or the screen contract changed after the review started | a screen added during the review | `new-review.mjs --refresh`, capture the new cells, look again |
| `review-cells` | a cell is missing, extra, or differs from the inventory | not captured; a stale shot left in the folder; re-shot without `--refresh` | capture it; delete strays; `--refresh` and look at the new shot |
| `review-capture` | a capture is unreadable, blank (at most two flat colours between the system bars), the wrong size or orientation | a white flash or black first frame; another model; a device not rotated, or an iOS landscape shot not turned upright | wait for the root testID; the planned device and orientation; `screenshotCommands` with the orientation |
| `review-axis` | two captures that differ only in theme, locale or text size are identical | the appearance, language or text size was not applied, or the app ignores it | apply the setting and capture again; an app that ignores text size is a BLOCKER |
| `review-videos` | a motion video is missing, not a movie, or not in the inventory | not recorded; a renamed screenshot; recorded without `--refresh` | record it (`recordVideo`, `screenrecord`), `--refresh` |
| `review-findings` | a finding is malformed or points at nothing | a grade like "MINOR"; a misspelt cell; a deferred FIX | the format of grading-rubric.md; fix or escalate BLOCKER and FIX |
| `review-floor` | an accessibility-floor finding, or a failed floor or data step, is not a BLOCKER | "it is only a little clipped" graded FIX | grade it BLOCKER |
| `review-device-pass` | a hardware entry, a result or the order is missing or wrong | the pass not run yet; `n/a` without a reason; results reordered | run the pass, answer every step in plan order |
| `review-fix-round` | the fix round is missing, unverified or a second critique | fixed findings with no round; a fixed cell never re-shot or a fixed video never recorded again; a named cell or video without a `seen` hash; a FIX opened while verifying | record the round; `--refresh` before re-shooting, re-shoot or re-record and `--refresh`; verification opens NOTEs only |
| `review-signoff` | the sign-off is missing, misdated, or contradicts the record | signed with a FIX open; a future date; the swept commit signed after a fix round; NOT SIGNED OFF without an escalation | fix the record or the verdict |

## check-signoff.mjs

| Rule | Meaning | Fix |
|---|---|---|
| `signoff-missing` | no review of this version, or the newest is NOT SIGNED OFF | review this version; never ship on a NOT SIGNED OFF record |
| `signoff-stale` | the plan or the screen contract changed after the review | review the changed screens again |
| `signoff-ui-changed` | a watched file (app code, assets, entry, config and the files it imports, lockfile, build transforms, `eas.json`, plugins, patches, env files, the plan's `signoff.watch`) changed after the signed commit | revert it, or re-shoot its screens on the new build and sign off again; a path that never reaches people goes in `signoff.ignore` before the review. An app config change that is only a build-number bump passes; with `--changed-from`, pass the `git diff -U0` output, not a name list |
| the `review-*` rules | the record does not hold up (without the captures) | as for check-review.mjs |

## Exit 2 (ERROR lines)

| Message | Cause | Fix |
|---|---|---|
| `nothing to check: contracts/design-review.json not found` | no plan yet | copy the template and fill it |
| `nothing to check: no app.config.ts, app.config.js or app.json` | not the app folder | pass the app folder as the first argument |
| `no version to release ...` | no `version` in the app config, or a computed one | keep it literal (or `version: APP_VERSION` with `const APP_VERSION = '1.2.0';`), or pass `--version` |
| `nothing to check: no design-review/<review-id>/review.json` | no review started | `new-review.mjs .` |
| `cannot read the screen contract ...` | the contract is missing or broken | screen-contracts creates it; `check-review-plan.mjs` first |
| `... is not a valid plan` | check-review, check-signoff, refresh on a broken plan | `check-review-plan.mjs` and fix it |
| `not a git repository, so the changes since the signed commit cannot be listed` | the gate ran outside the repository | run in the repository, or pass `--changed-from` |
| `cannot compare the signed commit ...` | a shallow clone without the signed commit | `fetch-depth: 0`, or `--changed-from` |
| `review id "..." is not <YYYY-MM-DD>-<slug>` / `... exists` | a bad or taken id | another `--id`, or `--refresh` |

## SKIP lines

`check-review-plan.mjs` prints at most these, each for a file another skill creates; everything else
still runs:

```
SKIP contracts/screens.json [plan-screens] not yet created (screen-contracts creates it)
SKIP src/ui/motion/motion-moments.ts [plan-motion] not yet created (motion-and-animation creates it)
SKIP contracts/debug-links.json [plan-open] not yet created (debug-menu-and-test-hooks creates it)
SKIP src/i18n/languages.ts [plan-locales] not yet created (i18n-strings-and-catalogs creates it)
```

Without `languages.ts` each locale's direction is still checked against the known right-to-left
languages, but nothing proves the app's right-to-left language is swept; the SKIP says so. A
`languages.ts` that exists but cannot be read is a `plan-locales` problem, never a SKIP.

`check-review.mjs`, `new-review.mjs` and `check-signoff.mjs` never skip: a review needs the screen
contract, and the release gate is a ship gate.

## Limits of the heuristics

Two rules judge pictures, the plan reads the app config with patterns, and the gate reads the app
config's imports with one; all are deliberately simple, so know what they do not see.

- **App config facts.** `userInterfaceStyle`, `supportsTablet`, `requireFullScreen`, `orientation`
  and `version` are read from `app.config.*` only when the value is a literal, or a top-level
  `const NAME = <literal>;` of the same file (`version: APP_VERSION`, the release lanes' shape). A
  computed value (`version: pkg.version`, `supportsTablet: isTablet`, a condition) is read as absent:
  no tablet required, light only assumed, no version for the gate. `check-review-plan.mjs` prints a
  note naming such keys. Keep them literal in the app config, or pass `--version` to the gate.
- **Config imports.** The gate follows `import ... from './x'`, `import('./x')` and `require('./x')`
  from `app.config.*`; a file read another way goes in `signoff.watch`.

- **Blank (`review-capture`)** counts the distinct colours on a sampled grid between the system bars
  (8 % at the top and at the bottom: the status bar, the home indicator, a navigation bar or taskbar).
  At most two is blank: a white flash, a black first frame, an empty window. The share of the main
  colour does not decide, because a correct sparse screen (an empty state on a tablet: a title, an
  icon, one line) leaves one colour on more than 99 % of the pixels. So a splash with its logo, or a
  screen showing only a spinner, is not blank to this rule: the wait for the screen's root testID is
  what keeps them out, and looking at the cell catches the rest. Generated test images need three
  colours or more, since real anti-aliased text always has them.
- **Axis (`review-axis`)** compares file hashes: it catches an appearance, language or text size that
  was not applied at all, not one that was applied halfway (a single screen still light in dark mode).
  Looking at every cell, worst cell first, is the check for that.
