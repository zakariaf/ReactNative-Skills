# Diagnosing a failure nobody has seen yet, and recording it

Read this when `find-fix.mjs` printed `no-known-fix`, or when a catalogue fix did not work. It is the
method, the places to look on iOS and Android, the stop rules and the exact shape of a new catalogue
entry. Commands verified on 2026-10-17 with Expo SDK 57, Xcode 26.6, Android SDK 36 and Maestro 2.10
(re-verify: `xcodebuild -version`, `sdkmanager --list_installed`, `maestro --version`).

## Contents

- The loop
- Where the evidence is
- Isolating the cause
- Stop and ask a human
- Writing the entry
- Adding a pitfall rule
- Worked example

## The loop

1. **Capture the exact text.** Copy the first error line, not the last: in xcodebuild, Gradle and Jest
   output the first error is usually the cause and the rest follow from it. Keep the command that
   produced it.
2. **Look it up again with less noise.** `find-fix.mjs --text "<the one distinctive line>"`, then two or
   three plain words for what you see ("banner never appears", "splash never hides"). A whole log goes
   in with `--log <file>` (error patterns only). `--platform ios|android` drops entries of the other
   platform; pass the repo root first (`find-fix.mjs . --text ...`) so entries for other package versions
   rank lower and say so.
3. **Read the area reference** for the step that failed. Rows marked `open` often explain behaviour
   that is not a bug in the app.
4. **Isolate** (below): reproduce once, change one thing, reproduce again.
5. **Fix the cause, never the check:** no widened tolerance, no skipped test, no `eslint-disable`, no
   lowered limit, no deleted assertion. A gate change needs the reviewer and a `Gate-Change:` trailer
   (quality-gates).
6. **Verify** with the command that failed, then the full gate of that area: `npm run -s check:fast`,
   `npm run verify`, the simulator or emulator build of the build skill, or the release gate.
7. **Record** the failure as a catalogue entry (below), add its exact first error line to
   `assets/known-queries.tsv`, run `check-catalogue.mjs --write`, then `check-catalogue.mjs`; when the
   cause is visible in repo files, add a pitfall rule with a planted bug.

## Where the evidence is

| Step | iOS | Android |
|---|---|---|
| Native build | the build skill's step logs (prebuild, xcodebuild); `xcodebuild ... 2>&1 \| tee` keeps the first `error:` | the Gradle log; rerun one task with `--stacktrace` (never `--scan`, it uploads) |
| JS bundle error inside a native build | `npx expo export --platform ios` shows it in seconds | `npx expo export --platform android` |
| App at runtime | `xcrun simctl spawn <udid> log show --last 2m --predicate 'process == "<Executable>"'` | `adb -s <serial> logcat -d -s ReactNativeJS AndroidRuntime ActivityManager` |
| Crash report | `~/Library/Logs/DiagnosticReports/<Executable>-*.ips` | `adb -s <serial> logcat -d -b crash` |
| Built app settings | `plutil -p <App>.app/Info.plist`; `plutil -p <App>.app/EXConstants.bundle/app.config` | `aapt2 dump badging <apk>`; `unzip -p <apk> assets/app.config` |
| Bundle content | `grep -a -c <text> <App>.app/main.jsbundle` (strings survive Hermes bytecode) | `unzip -p <apk> assets/index.android.bundle \| grep -a -c <text>` |
| Jest | the first `●` block of the failing suite; one file: `npx jest <path> --selectProjects unit` (path first) | the `android` project: `npx jest <path> --selectProjects android` |
| TypeScript | `npm run -s typecheck`; the error code (`TS2593`, `TS4111` ...) is the fastest lookup key | same |
| ESLint | `npx eslint <file> --max-warnings 0`; the rule id in the last column | same |
| Maestro | the flow output and `~/.maestro/tests/<run>/` (screenshots of the failing step) | same |

Always name the device: `xcrun simctl ... <udid>`, `adb -s <serial> ...`, `maestro --device <id>`. A
command that picks "the booted simulator" or "the only device" can reach another session's.

## Isolating the cause

- **Reproduce once, cleanly.** Native problems: a clean prebuild (`npx expo prebuild --platform <p>
  --clean`) with the same environment variables. Test problems: the one test file alone.
- **Change one thing at a time** and write down each attempt (what changed, what happened). Two changes
  at once hide which one mattered.
- **Suspect the newest change first:** a dependency bump, a config edit, a new plugin, a file in a gated
  path. `git diff`, `git log -p -1 -- <file>`.
- **Suspect the environment second:** the Xcode that ran (`xcodebuild -version` under the same
  `DEVELOPER_DIR`), the JDK Gradle used (`java -version` of `JAVA_HOME`), the Node version (`node -v`
  against `.nvmrc`), a stale Metro cache (the variant key), a simulator or emulator another session
  changed, an overloaded machine (load average far above the core count).
- **Make a minimal repro in a scratch copy** when the cause is inside a library: a copy of the repo (never
  the real one) with the smallest change that still fails. Read the library's installed source in
  `node_modules/<pkg>` before trusting its docs; the stack here is newer than most documentation and
  than an agent's training data.
- **Stop after three failed hypotheses** and report what was tried; "stuck, here is the evidence" beats
  a clever workaround.

## Stop and ask a human

Stop, send one message (the step, the exact error line, the one action needed) and wait, whenever the
fix needs:

- a password, `sudo`, the keychain, an Apple or Google account, a console (App Store Connect, Play
  Console, AdMob, EAS), an agreement, a licence acceptance, or a physical device;
- a change to a quality gate, a limit, a tolerance or a golden file;
- a product decision (a price, a store setting that cannot be undone, which data to delete);
- anything outward-facing or irreversible: uploading, submitting, tagging, pushing, deleting data that
  is not scratch, rotating a key.

Never retry a stop in a loop: keychain, 401/403 and agreement errors can lock an account or burn build
numbers. git-commits-and-reporting owns the stop message and the report format.

## Writing the entry

Add one object to `entries` in `assets/known-failures/<area>.json`. Never edit the rendered
`references/<area file>.md`; `check-catalogue.mjs --write` renders them.

| Field | Rule |
|---|---|
| `id` | `<area>-<what-failed>`, kebab-case, unique (for example `build-metro-cache-variant`) |
| `topic` | a short group heading inside the area (reuse an existing topic when one fits) |
| `symptom` | what you see, as close to the literal error text as possible, so a later search finds it |
| `cause` | why it happens, in one sentence |
| `fix` | the action that fixes the cause, specific enough to do without re-diagnosing |
| `match` | regular expressions (JSON-escaped: `"ITMS-9018\\d"`) that match the error text in a log; `[]` when there is no stable text. At least four characters, never one that matches an empty line, and specific: a pattern that matches ordinary log lines floods every lookup |
| `status` | `verified` (seen and fixed in a real run), `documented` (read in the tool's source or docs, not reproduced), `open` (not settled: the fix is the current fallback) |
| `needsHuman` | `true` when the fix needs a person (a stop) |
| `skill` | the skill that owns the full procedure (a name listed in `index.json` `skills`), or `null` |
| `platforms` | leave out when it happens on both; `["ios"]` or `["android"]` otherwise |
| `appliesTo` | optional `{ "<package>": "<range>" }` (`"57.x"`, `">=4.5 <5"`) for a version-bound failure; lookups rank it lower in repos outside the range, and an SDK upgrade reviews these first. The range includes the current stack version (a failure of a newer major goes in the text, not in `appliesTo`) |

Write for any app: generic nouns, "the developer", no machine paths. `index.json` `bannedTerms` fails
private product nouns and paths (`entry-banned-term`). When an `open` entry is settled, change its
status and fix; never add a second entry. When an upgrade makes an entry stale, delete it or narrow its
`appliesTo`.

Then add the exact first error line as `<id><TAB><line>` to `assets/known-queries.tsv`:
`check-catalogue.mjs` fails `query-missing` for an entry with match patterns and no line, and
`query-not-first` when another entry outranks it.

## Adding a pitfall rule

When the cause can be seen in repo files before it fails (a config key, a call, a dependency version),
add a rule to `scripts/lib/pitfalls.mjs` named after the entry id: build paths from `ctx.globs` (made
from `resolveLayout`, so a moved `src/` or a workspace app is followed), skip test files for runtime
rules, and keep the message to one line. Then add one planted bug for it to
`tests/fixtures/check-known-pitfalls/CASES.json` as `bad-<id>` with an `EXPECT.txt` naming `[<id>]` and
`file:line`, and run `node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs`. `check-catalogue.mjs` fails
`pitfall-id` for a rule whose id has no entry.

Know the limits before trusting a PASS. The rules are text heuristics over comment-masked source, not
a type checker:

- **They see literal calls only.** An argument list passed to the literal `'adb'` and a device
  command typed after `adb` in a script are found; an adb path held in a variable
  (`execFileSync(ADB, args)`) is not. android-emulator-build's
  own checker owns the full device rule (adb, emulator, `adb kill-server`, Gradle install tasks).
- **Commands that name no device are allowed on purpose.** `adb devices`, `adb version`,
  `adb start-server` and `adb help` pass; `-e`, `-d` and every device command (shell, install, logcat,
  reverse, forward, emu, push, pull, ...) need `-s <serial>` first.
- **The store-selector rule reads the selector's shape.** It flags an arrow passed straight to a
  `use...Store(` hook that returns `({ ... })`, `[ ... ]`, or a fresh array from `.filter`, `.map`,
  `.slice`, `.concat`, `.flatMap`, `.toSorted`, `Object.keys/values/entries` or `Array.from` (also
  chained). A result read further (`.length`, `[0]`, `.join(...)`) is a stable value and stays silent;
  a result combined with an operator (`s.items.filter(...) ?? []`) and a named selector function
  (`useStore(selectOpenTasks)`) are known misses. `useShallow(...)` is the fix.
- **One finding per line.** `grep`-style rules report every matching line of every file, so a second
  bad call in the same file shows up in the same run; rules that compare files (a missing key, a
  missing plugin entry) report once per file.
- **A false positive is fixed in the rule, never with a disable comment.** Narrow the pattern, add a
  `pass-<case>` that proves the correct code stays silent, and keep the `bad-<id>` case failing.

## Worked example

A production export showed the debug menu. `find-fix.mjs --text "production build shows debug menu"`
found nothing (before this entry existed). The loop:

1. `grep -a -c TEST_BUILD_SENTINEL <App>.app/main.jsbundle` printed 1 in the production build: test
   code shipped.
2. A production build right after a cleared Metro cache printed 0; after a development build it printed
   1. Cause isolated: the cache, not the gate.
3. Fix: `config.cacheVersion = publicEnvCacheVersion(process.env)` in `metro.config.js`; proved by a
   development build followed by a production export of the same tree.
4. Entry (in `assets/known-failures/build.json`):

```json
{
  "id": "build-metro-cache-variant",
  "topic": "Variants",
  "symptom": "A production bundle still contains test-only code right after a development build on the same machine",
  "cause": "Metro inlines EXPO_PUBLIC_* values at transform time but does not key its cache on them",
  "fix": "Set config.cacheVersion from the public values in metro.config.js; prove it with a development build followed by a production export",
  "match": ["production bundle (still )?contains test"],
  "status": "verified",
  "needsHuman": false,
  "skill": "app-variants-and-environment"
}
```

5. The query line `build-metro-cache-variant<TAB>check-apk [test-code]: production bundle still contains
   test-only code` went into `assets/known-queries.tsv`.
6. Because the cause is visible in a file, `pitfalls.mjs` got the rule `build-metro-cache-variant` (a
   metro config without the key) and `CASES.json` the case `bad-build-metro-cache-variant`.
