# Example: a pull request is red in CI and green on the developer's Mac

A shape to imitate when CI disagrees with a local run. The app is a Tasks app; the pull request
fixes a naming-conventions lint error by renaming `src/features/tasks/components/Task-row.tsx` to
`task-row.tsx` (a case-only rename) and updates the import in `tasks-screen.tsx`.

## What the run says

The `ci / verify` check fails. The job log ends with:

```
verify: step "typecheck" failed (exit 2); later steps did not run
src/features/tasks/tasks-screen.tsx(4,25): error TS2307: Cannot find module './components/task-row' or its corresponding type declarations.
```

On the developer's Mac `npm run verify` passed a minute before the push.

## How to read it

1. **Same command?** The workflow runs `npm ci` and `npm run verify`, the same script as the
   pre-push hook (`check-ci-lanes` `verify-gate`). So the difference is in the machine or the files,
   not in the gates.
2. **Same Node?** `setup-node` read `.nvmrc` (26.4.0); the log's "Set up Node" step prints it.
   `node --version` locally matches. Not the toolchain.
3. **Same files?** CI checks out what the commit holds, not what the Mac's disk holds, so ask git:

   ```sh
   git ls-files | grep -i task-row
   # src/features/tasks/components/Task-row.tsx
   ```

   The commit still holds the old name. The rename was made with `mv` on macOS, whose default file
   system ignores case, and git there runs with `core.ignorecase=true`: it saw the same file under the
   same name and recorded no rename. Locally `./components/task-row` resolves to the renamed file on
   disk, so `npm run verify` passes; the Linux runner checks out `Task-row.tsx`, and its file system
   does not ignore case. CI is right.
4. **The artifact.** `verify-reports` holds the reports written before the failing step; for a
   typecheck failure the log is enough. For a failed E2E lane, download `ios-reports` or
   `android-reports` and open the screenshots before touching any code.

## The fix

Record the rename in git (the import is already right):

```sh
git mv -f src/features/tasks/components/Task-row.tsx src/features/tasks/components/task-row.tsx
git ls-files | grep -i task-row        # now src/features/tasks/components/task-row.tsx
```

Commit it (git-commits-and-reporting), then verify what the commit holds, not the working tree, the
way CI does: a fresh clone of the branch on a case-sensitive volume, or simply push and read the run.
Locally `rm -rf node_modules && npm ci && npm run verify` still passes as before; it cannot prove a
case problem on a case-insensitive disk. The check turns green.

## What was not done

- No `continue-on-error: true` on the job "until it is fixed", no `|| true` after `npm run verify`
  (`check-workflows` `soft-fail`).
- No `npx tsc` step with other flags added to the workflow to "see more" (`check-ci-lanes`
  `ad-hoc-command`): `npm run -s typecheck` locally shows the same output.
- No re-run of the job hoping it passes: a red gate on an unchanged commit is deterministic until
  proven otherwise; a lane that passes on re-run is a flaky lane, which is a bug (device-lanes.md).
- No import rewritten back to `./components/Task-row` to match the stale index: that hides the
  rename and the naming lint fails next.
- The report to the reviewer names the run URL, the cause in one line (a case-only rename git did not
  record on macOS) and the commit that fixed it.
