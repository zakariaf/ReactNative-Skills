# check-ota rules

What `scripts/check-ota.mjs` checks, how it reads the repo, each rule with what it flags and the
fix, when it prints SKIP or NOT APPLICABLE, and what it leaves to review or to other skills.

## Contents

1. How it reads the repo
2. When the check applies
3. Config rules
4. Channel rules
5. Code rules
6. Command rules
7. Options and rn-skills.config.json
8. What it does not check

## 1. How it reads the repo

- **The app config is evaluated, not parsed:** `app.config.ts` is imported once per variant
  (`development`, `preview`, `production`, or `--variants`) in its own child process
  (`scripts/lib/evaluate-app-config.mjs`, cwd the app folder) with `APP_VARIANT` and
  `EXPO_PUBLIC_APP_VARIANT` set, through Node's type stripping (Node 22.18+), so spreads, helpers and
  per-variant logic count exactly as Expo sees them, including a module the config imports that
  reads the variant at module scope (fixture `bad-launch-nonblocking-module-scope`). Functions in the
  config (inline plugins) are read as placeholder strings. `app.json` is read as JSON. A config that
  cannot load (it imports an uninstalled package, or throws) is exit 2, and the Fix names the change.
- **Import forms:** Expo's loader accepts two forms plain Node refuses; the evaluator maps both
  (`module.registerHooks`, Node 22.15+): `import { ConfigContext, ExpoConfig } from 'expo/config'`
  (a value import of two types; `expo/config` becomes a module exporting those names as undefined)
  and extensionless relative imports (`./src/config/updates-config`, tried with `.ts`, `.tsx`, `.mts`,
  `.js`, `/index.ts`). The house style needs neither: `import type` for expo/config and the `.ts`
  extension on relative imports. A config that reads other values from `expo/config` at run time
  is not supported (exit 2).
- **Shipping variants** are every evaluated variant except `--dev-variant` (default `development`);
  an **OTA variant** is a shipping variant whose `updates.enabled` is not `false`.
- **eas.json** build profiles are resolved with their `extends` chains (env merged one level). A
  profile's **variant** is `env.APP_VARIANT`, else its EAS environment: `environment`, else EAS Build's
  default (production for store distribution, development for a development client, preview
  otherwise). A profile that others extend and that names no channel, `APP_VARIANT` or `environment`
  is an abstract base and is not checked.
- **Commands** come from `package.json` scripts, `*.sh`/`*.bash` files, `.github/workflows/*.yml`,
  `.eas/workflows/*.yml` (shell lines and `type: update` jobs; YAML folded scalars are joined) and
  string literals of `.ts`/`.js` files under the scripts folder (comments and `*.test.*` files are
  skipped). The repo walk skips installed skills (`.agents/`, `.claude/`, `skills/`, …), folders
  holding a `SKILL.md`, `node_modules`, generated `ios/`/`android/` and build output.

## 2. When the check applies

| Repo fact | Result |
|---|---|
| no `expo` dependency | NOT APPLICABLE: package.json has no expo dependency |
| no `expo-updates`, no `updates.url`, no `eas update` command | NOT APPLICABLE: expo-updates is not in package.json dependencies |
| `updates.enabled: false` in every shipping variant and no `eas update` command | NOT APPLICABLE: updates.enabled is false in every shipping variant of `<config>` |
| `expo-updates` installed, updates on, no variant sets `updates.url` | one `updates-config` problem; nothing else is checked until the app decides |
| no eas.json and no `expo-channel-name` request header | `SKIP eas.json [build-channel] not yet created (eas-build-and-submit creates it)` |

## 3. Config rules

| Rule | Flags | Fix |
|---|---|---|
| `updates-config` | expo-updates installed and updates on but no `updates.url` (in any OTA variant); `updates.url` without the package; expo-updates in devDependencies | spread `updatesConfig(EAS_PROJECT_ID)`, or `updates: { enabled: false }`; `npx expo install expo-updates` |
| `updates-off-publish` | an `eas update` command while updates are off everywhere or the package is missing | delete the command, or turn OTA on |
| `runtime-policy` | `runtimeVersion` other than exactly `{ policy: 'fingerprint' }`; an `ios`/`android` `runtimeVersion` that differs | `updatesConfig()`; delete the platform override |
| `updates-url` | `updates.url` not `https://u.expo.dev/<uuid>`, or its id differs from `extra.eas.projectId` | one `EAS_PROJECT_ID` constant for both |
| `launch-nonblocking` | `fallbackToCacheTimeout` above 0; `useEmbeddedUpdate: false` | 0; delete the key |
| `error-recovery` | `checkAutomatically` other than `ON_LOAD`, with the reason per value: `NEVER` turns off error recovery's fix check, `ON_ERROR_RECOVERY` asks only after a crash at launch (a fix for any other bug waits for the JS checks), `WIFI_ONLY` delays fixes on cellular; `disableAntiBrickingMeasures: true`; `useNativeDebug: true` | `ON_LOAD`; delete the keys |
| `fingerprint-scripts` | no `fingerprint.config.js`; it does not load; it skips every script (`PackageJsonScriptsAll`); its hook drops a lifecycle script or keeps `lint`/`start` | copy `templates/fingerprint.config.js` and its test |

The fingerprint rule loads the config with `require()` and calls its `fileHookTransform` on sample
scripts (`preinstall`, `install`, `postinstall`, `preprepare`, `prepare`, `postprepare`, `eas-build-pre-install`,
`eas-build-post-install`, `eas-build-on-success`, `lint`, `start`): the lifecycle ones must stay, the
others must go. `.fingerprintignore` lines and `ExpoConfigAll` are eas-build-and-submit's
`fingerprint-config` rule.

## 4. Channel rules

| Rule | Flags | Fix |
|---|---|---|
| `build-channel` | a non-dev-client profile whose variant is not an evaluated one (`--variants`); a profile of an OTA variant with no `channel` or another one (Expo's starter eas.json: fixture `bad-build-channel-missing`); an environment (its own or EAS Build's default) that differs from the channel; one channel baked into two variants; an OTA variant no profile builds; in the local lane, an `expo-channel-name` header that differs from the variant | `"channel": "<variant>"`, `"environment": "<variant>"`; a profile per shipping variant |

## 5. Code rules

| Rule | Flags | Fix |
|---|---|---|
| `updates-adapter` | no adapter (`<servicesDir>/<concern>/*-adapter.ts`, the canonical ESLint config's vendor-SDK allowance) imports expo-updates; any other source file imports it (a feature model calling `Updates.useUpdates()`); tests and `__mocks__` excluded | copy `templates/src/services/updates/`; reach updates through the UpdatesPort |
| `adapter-enabled-guard` | a file that calls `checkForUpdateAsync`, `fetchUpdateAsync` or `reloadAsync` and never reads `Updates.isEnabled` (or imports `isEnabled`); a file that calls `checkForUpdateAsync` or `fetchUpdateAsync` and never names `ERR_NOT_AVAILABLE_IN_DEV_CLIENT` (a development build reports `isEnabled` true and rejects with that code) | return `{ kind: 'disabled' }` first; map the dev-client code to `disabled` |
| `emergency-launch` | no expo-updates importer reads `Updates.isEmergencyLaunch` | expose it in `running()`; `reportLaunch()` records it |

The adapter rules are text heuristics over one file: an adapter that reads the code through a
helper in another file (so the code string is not in the adapter) is flagged; one that names the
string without mapping it passes. Review covers that limit.

## 6. Command rules

| Rule | Flags | Fix |
|---|---|---|
| `update-target` | `eas update` without `--channel`/`--branch`, or with `--auto`; without `--message` | name the channel and say what it fixes |
| `update-environment` | no `--environment` (an EAS Workflows `type: update` job without `environment:`, which defaults to production); a literal channel published with another literal environment; an expression channel with an environment that is not the same expression | `--environment <channel>` |
| `staged-rollout` | an update to a store channel (a profile with distribution `store`; `production` in the local lane) without `--rollout-percentage` 1 to 25 (`params.rollout_percentage` in EAS Workflows); an expression channel with no `--rollout-percentage` when a store channel exists | `--rollout-percentage 10`, then `eas update:edit`; literal channels per job |
| `gates-first` | a shell `eas update` with no `npm run verify`, `run-verify.ts` or `update-preflight.ts` earlier in the same file or script; an EAS Workflows `type: update` job that needs (directly or through other jobs) neither a job running one of those nor a `type: fingerprint` plus `type: get-build` pair whose outputs its `if:` reads | run the preflight first; in EAS Workflows, `needs:` the gate job or use the fingerprint pattern (channels-branches-and-publishing.md section 9) |
| `cross-channel-republish` | `eas update:republish` with `--destination-channel` or `--destination-branch` | publish the commit per channel |
| `rollback-manual` | `update:rollback`, `update:roll-back-to-embedded`, `update:revert-update-rollout`, `channel:pause`, `channel:rollout`, `channel:edit` in a CI workflow | run by hand, after the incident runbook |
| `update-preflight` | eas.json exists (OTA on) but `scripts/ota/update-preflight.ts` (or `otaPreflight`) is missing | copy the preflight and `update-plan.ts` |

**The channel of a command** is `--channel`, or a literal `--branch` named like a channel (a store
or OTA channel): channels read the branch of the same name until someone relinks them, so
`eas update --branch production` reaches production phones and needs production's environment and a
staged rollout (fixture `bad-staged-rollout-branch`). An expression `--branch` (`pr-${{ … }}`) and a
branch no channel is named after (`pr-42`) are previews: only `--environment` and `--message` are
required (fixture `pass-pr-branch`). A relinked channel (`eas channel:edit`) is outside this rule.

A channel given as `$VAR` or `${{ … }}` (an expression) cannot be compared with a literal, so:

- `update-environment` requires `--environment` to be the **same** expression (`--channel
  ${{ inputs.channel }} --environment ${{ inputs.channel }}`); anything else is flagged;
- `staged-rollout` requires `--rollout-percentage` to be present (any value, an expression too) when
  the repo has a store channel, because the expression may name it (fixture
  `bad-staged-rollout-expression`). The fix it names is one job per channel with literal channels
  (`examples/ota-update-workflow.yml`), since one rollout cannot suit preview and production;
- the preflight checks the real values at run time.

## 7. Options and rn-skills.config.json

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-ota.mjs [repo-root] [--app-dir apps/mobile] \
  [--variants development,preview,production] [--dev-variant development] [--json]
```

`rn-skills.config.json` key read: `"otaPreflight"`: the repo-relative path of the update preflight.
The source and scripts folders come from `resolveLayout` (`srcDir`, `servicesDir`, `scriptsDir`).

## 8. What it does not check

- Whether a runtime version is live on its channel: that needs EAS; the update preflight does it.
- Whether the EAS environments hold `APP_VARIANT` and the other variables (an account setting).
- Whether a rollback is safe for the data: run-migration's ledger and a person.
- Imports of expo-updates outside `src/` (the canonical ESLint config's vendor-SDK rule covers the
  whole app) and awaits on the startup path (app-startup-and-bootstrap's checker).
