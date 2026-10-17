# Restoring a snapshot

The open path (persistence-and-migrations) copies a database that holds tables to
`<file>.v<from>.bak` with `VACUUM INTO` before its first pending step runs, reuses that copy while a
step keeps failing, and keeps the newest two copies after a success. This reference is about using
that copy: when a restore is the right move, how `restore-snapshot.mjs` does it in a folder, on an
iOS simulator and on an Android emulator or device, and what a restore cannot do.

## Contents

- When to restore, and when to fix forward
- What a snapshot is
- The restore, step by step
- Local folder
- iOS simulator
- Android emulator or device
- Physical iPhones and users' phones
- Pitfalls

## When to restore, and when to fix forward

| Situation | Do |
|---|---|
| A step failed (`migration-failed`) | Nothing to restore: the step rolled back, the file is at its last version. Ship a fixed step. |
| A pending step committed something wrong on a developer or QA device | Restore that device's snapshot, then install a build with the fixed step. |
| A shipped step committed something wrong on users' phones | Fix forward: version N+1 repairs what the file still holds. You cannot restore users' phones. |
| A previous build shows `newer-version` | Never restore to "go back": install the current build again (release-ritual.md, rollbacks). |
| Support has a user's file and its `.bak` (a support export) | Restore on a copy to inspect what the step did; send a repair through a new version. |

A restore discards every write made since the upgrade from the live database (they stay in the
`kept-<time>/` folder). That is why it is a stop-and-ask step: the developer agrees first, every time.

## What a snapshot is

- A full, self-contained SQLite file written by `VACUUM INTO` (no `-wal`), at the version the
  upgrade started from: `app.db.v3.bak` is the database as it was at version 3, right before step 4.
- Taken only when the file holds tables (a new install has nothing to keep) and only when no healthy
  copy for that version exists yet; a partial copy (a launch killed during `VACUUM INTO`) is deleted
  and taken again.
- Kept: the newest two after a successful upgrade. A restore therefore reaches at most two upgrades
  back, and only on the device where the upgrade ran.
- Needs about the file's size in free space; on a full disk the upgrade stops with `storage-full`.

## The restore, step by step

`node ${CLAUDE_SKILL_DIR}/scripts/restore-snapshot.mjs [repo-root] <target> [--from N] [--db-name app.db]`
does the following (the optional repo root, default `.`, only anchors a relative `--dir`):

1. Lists the database folder and picks `<db>.v<N>.bak` (the highest N, or `--from N`).
2. Checks the copy before touching anything: it must open, pass `quick_check` and stamp
   `user_version = N`; otherwise `FAIL [snapshot-health]` and nothing moves. Every read works on a
   temporary copy (the file and its `-wal`), never the live file: even a read-only SQLite connection
   to a WAL database creates `-wal` and `-shm` beside it and cannot remove them. The dry run checks
   that the folder lists exactly the files it listed before (exit 2 otherwise).
3. Prints the plan (stop the app; move `app.db`, `-wal`, `-shm` into `kept-<time>/` beside them;
   copy the snapshot over `app.db`) and stops: `STOP: restoring discards every write made since the
   upgrade`. Ask the developer.
4. With `--yes`: stops the app (`STOPPED …`), moves the current files aside, copies the snapshot in, and reads the
   result back (same `user_version`, `quick_check` ok, no `-wal` beside it). A result that does not
   read back is exit 2 with the manual steps.
5. Prints `NEXT`: launch only a build whose step is fixed. The same build reruns the same step on the
   restored file and does the same damage again (and takes a new snapshot first, so it is still
   recoverable).

Why the `-wal` and `-shm` move with the database: a `-wal` left beside a restored file belongs to the
newer database; SQLite would replay its pages into the restored file on the next open and produce a
mix of both, or a damaged file.

## Local folder

```sh
node ${CLAUDE_SKILL_DIR}/scripts/restore-snapshot.mjs --dir ./support/case-142
node ${CLAUDE_SKILL_DIR}/scripts/restore-snapshot.mjs --dir ./support/case-142 --yes
```

For a copy on this computer: a support export, or a folder you copied out of a device. Nothing may
hold the file open (the app, a SQLite viewer, a test). This mode is what the self-test proves.

## iOS simulator

```sh
xcrun simctl list devices                                   # find the UDID; never "booted"
node ${CLAUDE_SKILL_DIR}/scripts/restore-snapshot.mjs --udid <udid> --bundle-id <id>
node ${CLAUDE_SKILL_DIR}/scripts/restore-snapshot.mjs --udid <udid> --bundle-id <id> --yes
```

The script finds the folder with `xcrun simctl get_app_container <udid> <id> data` +
`Documents/SQLite` (expo-sqlite's default directory, read in its native sources, 57.0.3), stops the
app with `xcrun simctl terminate <udid> <id>`, then works on the files directly (a simulator's
container is a folder on the Mac). Any build works; the app must be installed and launched once, and
the simulator booted (`get_app_container` answers only on a booted device). An app that is not
running is the usual case: simctl then exits 3 with "found nothing to terminate", and the script
prints `STOPPED <id> was not running on <udid> (nothing to terminate)` and goes on. Any other
terminate failure stops the restore (exit 2) before a file moves.

## Android emulator or device

```sh
adb devices                                                 # emulator-5580 is the one you started
node ${CLAUDE_SKILL_DIR}/scripts/restore-snapshot.mjs --serial emulator-5580 --package <id>
node ${CLAUDE_SKILL_DIR}/scripts/restore-snapshot.mjs --serial emulator-5580 --package <id> --yes
```

The serial is the one of the emulator you started for the job, on a pinned port
(`emulator -avd <project>-migration -port 5580 -no-snapshot &`, as in release-ritual.md), so it is
known before the emulator runs; never take the first `emulator-55xx` that `adb devices` lists, which
may be another session's. A physical phone's serial is the one `adb devices -l` shows next to its
model. When the case is closed: `adb -s emulator-5580 emu kill` and
`avdmanager delete avd -n <project>-migration`.

The app's files are private, so every step goes through `adb -s <serial> shell run-as <id>`, which
needs a debuggable build: the development variant or a local debug build
(`npx expo run:android --variant debug`). Preview and production builds are release builds and refuse
with `run-as: package not debuggable` (android-emulator-build requires every shipping variant to be
non-debuggable, preview included). The script stops the app with `am force-stop`, reads the snapshot
out with `exec-out run-as <id> cat files/SQLite/<name>` to check it on the computer, then moves and
copies inside the app's folder with one `run-as … sh -c` command, so the database never travels back
over adb. The folder is `files/SQLite` (`/data/data/<id>/files/SQLite`). The same commands work on a
physical Android phone with a debuggable build.

**A Release build on Android** has no restore mode here, by design: files written as root lose the
app's owner and SELinux label, and the app then cannot open its own database. To investigate a
Release build, run it on an emulator made from a `google_apis` image (`adb root` works there), read
the files with persistence-and-migrations' `inspect-database.mjs --serial <serial> --package <id>
--android-root` (or `adb -s <serial> root` and `adb -s <serial> pull /data/data/<id>/files/SQLite/`),
restore the copy with `--dir`, and test the fixed step in a debug build of the same version.

The simulator and emulator modes call only the commands above. The self-test runs both against
stand-in `xcrun` and `adb` commands that answer from folders (app not running, app running,
terminate failing, an emulator restore); a full restore on a real device was not run for this
skill.

## Physical iPhones and users' phones

- A development-signed build on a physical iPhone: Xcode, Window > Devices and Simulators, the app,
  "Download Container…" gives a copy; restore it with `--dir`, then "Replace Container…". App Store
  and TestFlight builds do not allow this.
- Users' phones: no tool reaches them, and none should. Their snapshots stay on the phone (the newest
  two) until the next successful upgrade prunes them. The way to use them is code that ships: a new
  version whose step repairs from what is left, or a support screen that shares the database file and
  its snapshots after the user agrees, so support can look (data-export-and-restore defines this
  support copy: not a backup, never restorable through its ladder). Such a repair step that reads a snapshot
  (for example with `ATTACH DATABASE`) is possible SQL but not proven by this skill; it needs its own
  content test and device proof.

## Pitfalls

- **Restoring with the app running.** The app holds the file open and may checkpoint its `-wal` into
  the restored file. The script stops the app first; with `--dir`, close everything yourself.
- **Restoring the oldest snapshot "to be safe".** Two upgrades back loses two upgrades of writes; take
  the copy from right before the bad step (`--from` the version the bad step started from).
- **Deleting `kept-<time>/` right away.** It holds the only copy of what the user wrote after the
  upgrade; delete it when the case is closed.
- **Restoring, then launching the same build.** The step runs again: install the fixed build first.
- **Android Auto Backup and iCloud.** A device restore from backup can bring back an older database
  (it then migrates normally: the every-path proof covers it) or a newer one (a reinstalled older
  build sees `newer-version`). Snapshots are in the backup unless excluded (persistence-and-migrations,
  file locations and backups).
