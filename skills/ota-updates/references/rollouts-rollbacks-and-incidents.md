# Rollouts, rollbacks and incidents

How a store-channel update reaches phones in stages, how to watch it, what the client does with a
broken update, how to roll back or pause, when a rollback is forbidden, and the incident runbook.
Verified on 2026-10-14 against docs.expo.dev/eas-update/{rollouts,rollbacks,error-recovery,eas-cli}
and the EAS CLI source (read in 24.12.1; still true in 25.0.0, checked 2026-10-16). Re-verify by reading those pages and
`package/build/commands/update/{edit,rollback,republish,revert-update-rollout,roll-back-to-embedded}.js`.

## Contents

1. Per-update rollouts
2. Watching a rollout
3. What the client does with a broken update
4. Rolling back
5. Pausing a channel
6. When a rollback is forbidden: data migrations
7. The incident runbook
8. Code signing (optional)

## 1. Per-update rollouts

`eas update --rollout-percentage 10` makes the new update available to 10% of phones on that branch
and runtime version; the others keep the previous update (the control). Rules from the docs and the
source:

- only one update rolls out per branch at a time; while it runs, a new `eas update` for the same
  runtime is refused unless `--force-end-active-rollout` ends it (a person's choice);
- raise the share with `eas update:edit [groupId] --rollout-percentage <n>` (1 to 100; 100 completes
  it); EAS Workflows has `type: update-rollout` for the same step behind an approval;
- `eas update:revert-update-rollout` ends it the other way: it republishes the control update, or,
  on a branch that had no update, publishes a roll-back-to-embedded directive;
- the library's first step on a store channel is 1 to 25% (`staged-rollout`); Expo's examples use 10%
  and 25%. A suggested ladder: 10% → watch at least one day of launches → 50% → watch → 100%.

## 2. Watching a rollout

- `eas update:insights <groupId>`: launches, crashes, unique users and size of the update group;
- `eas channel:insights --channel production --runtime-version <rv>`: adoption and crashes per channel
  and runtime;
- the EAS dashboard's update page (failed installs: phones that downloaded and could not launch it);
- the crash reporter, with every event tagged by update id, channel and runtime version
  (crash-reporting-and-observability: read them from the UpdatesPort's `running()`);
- the app's own error log: `reportLaunch()` records an emergency launch once per launch.

Raise the share only when the crash-free rate of the new group is no worse than the control's.

## 3. What the client does with a broken update

expo-updates' error recovery (docs, "Error recovery"; the docs say the behaviour may change):

- a fatal JS error more than 10 seconds after the first render is not caught at all;
- an error before the first view appeared ("content appeared"), on the first launch of that update:
  the update is marked failed and never launched again on that phone; the client waits up to 5 s for
  a newer update (unless `checkAutomatically` is `NEVER`), launches it if it arrives, else rolls back
  to the most recent update that launched successfully, else crashes;
- an error after content appeared: the client checks for a new update for up to 5 s, then rethrows;
  it never rolls back, because the broken code may already have written data.

So recovery needs the native launch check (`checkAutomatically: 'ON_LOAD'`, `error-recovery`) and a
fix on the server. `Updates.isEmergencyLaunch` is true when the client fell back to the embedded
bundle; the adapter exposes it and the checker requires it to be read (`emergency-launch`). On iOS the
crash shows as `EXUpdatesAppController throwException` from `EXUpdatesErrorRecovery`; on Android as
`FATAL EXCEPTION: expo-updates-error-recovery` with the JS exception: both are JS errors.

## 4. Rolling back

`eas update:rollback` (interactive) offers two kinds:

- republish a previous update: it becomes the newest update on the branch and phones download it at
  their next check (`eas update:republish --group <id>` or `--branch <name>` does the same directly);
- roll back to the embedded update (`eas update:roll-back-to-embedded --channel <c>
  --runtime-version <rv>`): phones stop using downloaded updates and run the bundle inside their
  binary, which differs per store version.

Publishing a new update after a rollback reaches everyone again. A rollback is outward-facing and
changes code on every phone of the channel: stop and ask the developer, and never script it in CI
(`rollback-manual`).

## 5. Pausing a channel

`eas channel:pause production` stops serving updates on that channel: phones keep what they run, the
server answers checks with an empty 204, monthly active users stop growing, and publishing to the
branch continues for later. `eas channel:resume production` serves again (a paused rollout resumes
too). Pausing is the first move in every incident (runbook step 2): it stops the spread without
publishing anything and sends no phone back to older code. It does not undo the update on phones
that already have it.

## 6. When a rollback is forbidden: data migrations

An update can carry JavaScript that migrates persisted data (a SQLite schema step, a save-document
version). run-migration's default is that a schema step ships in a store build. When it goes out as
an EAS Update, run-migration's release ritual owns the order, and this library has no staging
channel or runtime override for it (only the three variants' channels exist, `build-channel`):

1. a Release build of the new code proves the first screen over the previous release's data;
2. stop and ask, then publish to the preview channel: every preview build takes it, so this publish
   ships the version (run-migration's `record-shipped.mjs` runs right after);
3. prove it on a preview build that holds data the previous version wrote;
4. only then publish to production, with a staged rollout (`staged-rollout`).

Four things put the previous code (N-1) over a version-N database, where it opens `newer-version`
with none of the user's data: `eas update:revert-update-rollout`, `eas channel:rollout` End > Revert,
`eas update:rollback` (to an earlier update or to the embedded one), and expo-updates' automatic error
recovery (a crash before the first screen on an update's first launch). Before any of the first three,
check whether an update published since the target carried a schema step (run-migration's ledger
records every version that shipped, EAS Updates included). If one did: never revert or roll back past
it; pause the channel (`eas channel:pause <channel>`, which sends nobody back) and fix forward with a
new update. persistence-and-migrations owns the open path for a database newer than the code
(`newer-version`).

## 7. The incident runbook

1. Confirm: crash spike or failed installs on the new group (`eas update:insights <groupId>`).
2. Stop the spread: `eas channel:pause <channel>` first, rollout running or not (it sends nobody
   back). Stop and ask before it.
3. Decide, by run-migration's ledger: no schema step in any update since the target → reverting a
   running rollout (`eas update:revert-update-rollout`, `eas channel:rollout` End > Revert) or
   `eas update:rollback` to the last good update is allowed, again after a stop-and-ask; a schema
   step → fix forward only, the channel stays paused until the fix is out.
4. Fix forward: the fix through the normal path (tests, `npm run verify`, the update preflight,
   preview channel first, then the store channel with a rollout step).
5. Resume the channel if paused; write down the update group ids, the commit and the decision.

## 8. Code signing (optional)

End-to-end code signing (`updates.codeSigningCertificate` + `codeSigningMetadata`, generated with
`npx expo-updates codesigning:generate`) makes the client verify each update with the app's own
certificate. It requires the EAS Production or Enterprise plan (docs, checked 2026-10-14). Keep the
private key outside the repository (the generator's `--key-output-directory ../keys`), pass it with
`--private-key-path` at publish time from the CI secret store, commit only the certificate, and plan
the key rotation before the certificate expires: binaries with an expired certificate apply no new
updates.
