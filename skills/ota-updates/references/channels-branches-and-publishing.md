# Channels, branches and publishing

Where a binary's channel comes from, how channels map to branches, the variables an update is
evaluated with, the exact `eas update` command and its flags, why an update is never promoted from
one channel to another, the update preflight, CI and EAS Workflows. EAS CLI flags verified by reading
the 24.12.1 source, still true in 25.0.0 on 2026-10-16 (`build/commands/update/*.js`, `channel/*.js`, `build/list.js`, `env/exec.js`) on
2026-10-14; the stack's floor is EAS CLI 24.10.0. Re-verify: `npm pack eas-cli` into an empty folder
and read `package/build/commands/update/index.js` (`static flags`).

## Contents

1. Channels are baked into the binary
2. One channel per variant, named like it
3. Branches: keep the default link
4. The environment an update is evaluated with
5. The publish command
6. The update preflight
7. Never promote an update across channels
8. Previews and development builds
9. CI: GitHub Actions and EAS Workflows
10. Without EAS Build (the local lane)
11. Protected channels and who may publish

## 1. Channels are baked into the binary

`eas build` writes the profile's `channel` into the native config of the binary (the
`expo-channel-name` request header). It cannot change after the build: each binary asks one channel
for updates for its whole life. (Since SDK 54, `Updates.setUpdateRequestHeadersOverride` can point an
installed release build at another channel at runtime, "channel surfing"; this library does not use
it by default, and `setUpdateURLAndRequestHeadersOverride` needs `disableAntiBrickingMeasures`, which
the checker forbids.) A profile without a channel builds a binary that receives nothing. EAS Build
warns when a profile names a channel but `expo-updates` is a devDependency or missing.

## 2. One channel per variant, named like it

| Variant (APP_VARIANT) | Build profile | channel | environment | Distribution |
|---|---|---|---|---|
| development | `development` (dev client) | none | development | internal |
| preview | `preview`, `preview-simulator` | `preview` | preview | internal |
| production | `production` | `production` | production | store |

Each shipping profile sets `channel` = its variant = `environment` (`build-channel`). The variant is
`env.APP_VARIANT` when eas.json sets it, else the `APP_VARIANT` of the profile's EAS environment; a
profile without `environment` loads EAS Build's default one: production for store distribution
(the default distribution), development for a development client, preview for everything else
(Expo docs, "Using environment variables with EAS Build", verified 2026-10-16). So Expo's starter
eas.json, which names no channel, builds preview and production binaries that never receive an
update: the checker flags each of them, and every shipping variant needs a profile that bakes its
channel.
`examples/eas.json` is eas-build-and-submit's template with only the two `channel` keys added (eas.json
allows no comment key: EAS CLI validates it with unknown keys refused). The development client, and
`development-simulator` that extends it, get no channel. Two
variants never share a channel: an update embeds one variant's evaluated config (app id, scheme,
`extra`, runtime version), so preview binaries running a production update would carry the
production id in `Constants.expoConfig`, and their runtime would not match anyway. A development
build ignores channels (`Updates.channel` is null there) and can open any compatible update from its
Extensions tab. naming-conventions owns the channel and branch names.

## 3. Branches: keep the default link

A channel points at a branch (an ordered list of updates); by default channel `production` reads
branch `production`, created on the first `eas update --channel production`. Keep that link and think
of channel and branch as one name. Re-pointing (`eas channel:edit production --branch <other>`) and
branch-based rollouts (`eas channel:rollout`) exist for teams that need them; they are outside this
library's default and the checker treats `channel:edit` and `channel:rollout` in CI as manual steps.
`eas update --channel <c>` is refused while a branch-based rollout runs on that channel.

Because of that link, `eas update --branch production` reaches every production phone just as
`--channel production` does: the checker treats a literal `--branch` named like a channel as that
channel (environment and staged rollout, fixture `bad-staged-rollout-branch`). `--branch` stays for
branches no channel reads, such as `pr-<n>` previews.

## 4. The environment an update is evaluated with

`eas update` evaluates `app.config.ts` locally, bundles with `npx expo export`, resolves the runtime
version per platform and uploads. With `--environment <env>` it loads that EAS environment's
variables into the config evaluation, the bundler and the runtime resolution, and sets
`EXPO_NO_DOTENV=1`. Without the flag on SDK 55 and later, a person at a terminal is asked for an
environment (and a non-interactive run there fails). **In CI the CLI neither asks nor fails:**
`environmentFlagNeededForSdk550OrGreater` (`build/update/utils.js`, EAS CLI 24.10.0 and 24.12.1)
returns false whenever `CI` or `EAS_BUILD` is set (or `EAS_UPDATE_SKIP_ENVIRONMENT_CHECK`, or with
`--auto`), so `eas update` runs silently with no EAS environment loaded, `EXPO_NO_DOTENV` unset and
any `.env` file read. The update then embeds another config and usually another runtime version.
That is why the checker enforces `update-environment` rather than leaving it to the CLI. The build
profile's `env` block in eas.json is **not** read by `eas update` either. Therefore:

- every EAS environment holds `APP_VARIANT` and `EXPO_PUBLIC_APP_VARIANT` as plain-text variables
  equal to its name (`eas env:create --environment production --name APP_VARIANT --value production
  --visibility plaintext`, and the same for `EXPO_PUBLIC_APP_VARIANT`; a developer step: stop and
  ask). The canonical resolver throws when both are unset during production bundling, so a missing
  variable fails the publish loudly instead of shipping a development config;
- every other variable the config or the bundle reads (`EXPO_PUBLIC_API_URL`, the ads mode) must
  exist in that environment with the values the channel's builds used: they change `extra`, the
  runtime version (the config is hashed) and the JS;
- `--environment` equals the channel (`update-environment`); EAS Workflows `type: update` jobs
  default to `production` when `environment` is omitted, so the checker requires it there too.

## 5. The publish command

```sh
eas update --channel production --environment production --platform all \
  --message "Fix the due-date crash on Android" --rollout-percentage 10 --non-interactive
```

| Flag | Rule |
|---|---|
| `--channel <c>` | required (`update-target`); `--branch` only in a branch-based flow; never `--auto` (it publishes to a branch named after the git branch, with the commit message) |
| `--environment <c>` | required, equal to the channel (`update-environment`) |
| `--message "<text>"` | required: what the update fixes, read later when deciding a rollback |
| `--rollout-percentage <n>` | store channels: 1 to 25 on the first publish (`staged-rollout`); preview needs none (allowed, 1 to 100) |
| `--platform ios\|android\|all` | default all; one platform only when the fix is platform-specific |
| `--non-interactive` | CI and the printed command; EAS CLI is non-interactive by default when `CI` is set or stdin is not a TTY |
| `--force-end-active-rollout` | ends a running rollout on that runtime so the new update supersedes it; only by a person |
| `--upload-source-maps` | uploads source maps to EAS for symbolication; crash-reporting-and-observability decides where maps go |
| `--private-key-path` | code signing (rollouts reference) |

The tree must be committed (`cli.requireCommit` in eas.json, eas-build-and-submit); each update group
records the git commit, so "which code runs on these phones" always has an answer.

## 6. The update preflight

`templates/scripts/ota/update-preflight.ts` (with `update-plan.ts` and its test) runs, cheapest
first: a clean committed tree; the channel exists in a build profile, with its variant (`env.APP_VARIANT`,
else the EAS environment's) and `environment` (its own, else EAS Build's default) equal to it, a message and a rollout step that fits; `npm run verify`; each platform's
runtime version, resolved through `eas env:exec <environment>` exactly as `eas update` does; the
finished builds on that channel (`eas build:list --channel <c> --status finished --json`, or a file
passed with `--builds`), whose `runtime.version` values must include every local runtime. Only then
it prints the `eas update` command, which the developer runs after saying yes. EAS CLI 24.12.1 exports
a `findCompatibleBuildsAsync` helper but no command calls it, so nothing else stops an update aimed at
a runtime no binary has.

```sh
node scripts/ota/update-preflight.ts --channel preview --message "Fix the due-date crash"
node scripts/ota/update-preflight.ts --channel production --message "Fix the due-date crash" --rollout 10
```

## 7. Never promote an update across channels

Expo's deployment guide suggests `eas update:republish --destination-channel production` to promote
a tested staging update, valid only when both channels' builds use identical environment variables.
In this library's variant model they never do (each variant has its own id and runtime), so a
republished preview update would reach no production phone, or, with a hand-set runtime, would run
the preview config there. Publish the same commit twice instead: once per channel, each with its own
environment (`cross-channel-republish`). `eas update:republish --group <id>` within one branch is
the rollback tool (rollouts reference).

## 8. Previews and development builds

- Preview channel: internal-distribution builds of the preview variant; publish there first, test on
  a phone (force-close and reopen twice: the first launch downloads, the second runs it), then
  publish the same commit to production.
- Pull-request previews: `eas update --branch pr-<n> --environment preview --message …` and open the
  branch in a development build; preview builds keep reading the `preview` branch.
- Development builds load updates through the dev launcher. There `Updates.isEnabled` is **true**, and
  `checkForUpdateAsync` and `fetchUpdateAsync` reject with code `ERR_NOT_AVAILABLE_IN_DEV_CLIENT`;
  the adapter reads that code (and `ERR_UPDATES_DISABLED`) and returns `{ kind: 'disabled' }`
  (app-integration section 3).

## 9. CI: GitHub Actions and EAS Workflows

- A GitHub workflow that publishes runs `npm ci`, `npm run verify` (or the preflight) and then the
  command, in one job (`gates-first`). Name the channel literally per job: a `preview` job with no
  rollout and a `production` job with `--rollout-percentage 10`, chosen by
  `if: inputs.channel == 'production'` (`examples/ota-update-workflow.yml`). One job with
  `--channel ${{ inputs.channel }}` cannot be both: a fixed rollout throttles the testers' preview
  update, no rollout sends production to everyone. The checker requires `--rollout-percentage` on an
  expression channel when the repo has a store channel, and `--environment` equal to the same
  expression. Free text such as the message reaches the shell only through `env:`
  (`MESSAGE: ${{ inputs.message }}`, then `--message "$MESSAGE"`), never as `${{ }}` inside `run:`,
  which GitHub's hardening guide calls script injection. ci-pipeline-and-gates owns caches, secrets
  (`EXPO_TOKEN`) and concurrency.
- EAS Workflows: a `type: update` job with `environment:` and `params.channel` equal; store channels
  set `params.rollout_percentage`; raise it later with a `type: update-rollout` job behind an
  approval, or by hand. The job `needs:` its gate (`gates-first`), in one of two shapes: a job that
  runs `npm run verify` or the update preflight, or Expo's fingerprint pattern, which proves the
  runtime is live (a finished build with this fingerprint exists) and publishes only then:

  ```yaml
  jobs:
    fingerprint:
      type: fingerprint
      environment: production
    get_ios_build:
      needs: [fingerprint]
      type: get-build
      params:
        fingerprint_hash: ${{ needs.fingerprint.outputs.ios_fingerprint_hash }}
        profile: production
        platform: ios
    get_android_build:
      needs: [fingerprint]
      type: get-build
      params:
        fingerprint_hash: ${{ needs.fingerprint.outputs.android_fingerprint_hash }}
        profile: production
        platform: android
    publish:
      needs: [get_ios_build, get_android_build]
      if: ${{ needs.get_ios_build.outputs.build_id && needs.get_android_build.outputs.build_id }}
      type: update
      environment: production
      params:
        channel: production
        message: Fix the due-date crash
        rollout_percentage: 10
  ```

  The checker accepts the second shape when the update job needs a `type: fingerprint` job and a
  `type: get-build` job and its `if:` reads that get-build job's outputs; it does not prove that
  every platform the update covers has its get-build job (keep one per platform, as above). Start
  such a workflow by hand or on tags (ci-pipeline-and-gates' `release-trigger` treats an update like a
  release). With crash reporting installed, add `upload_sentry_sourcemaps: true` under `params`.
- Rollback, rollout revert and channel pause, rollout or edit never run from CI (`rollback-manual`):
  each is a judgement about data and users.

## 10. Without EAS Build (the local lane)

When binaries are built with `expo prebuild` + Xcode/Gradle (ios-release-testflight,
android-release-play), the channel comes from the app config: `updates.requestHeaders:
{ 'expo-channel-name': '<variant>' }` per variant, applied at the next prebuild. The checker accepts
that form when eas.json does not exist. The preflight needs finished-build records; pass them with
`--builds <file>` (a JSON list with `platform`, `status`, `updateChannel.name`, `runtime.version`).

## 11. Protected channels and who may publish

`eas channel:protect production` limits publishing to and changing the channel to the Release
Manager, Admin and Owner roles. Turn it on for the store channel once more than one person can
publish; it is an account setting, so it is the developer's step.
