# Environment variables

How a variable gets from a `.env` file, an eas.json profile or an EAS environment into the config and
the JS bundle, and the one way app code reads it. Verified on 2026-10-03 against the Expo SDK 57
packages (`babel-preset-expo` 57.0.13, `@expo/metro-config`, expo 57.0.26), the Expo docs for SDK 57
(`/guides/environment-variables`, `/eas/environment-variables`, `/eas/json`) and EAS CLI 24.10.0.
Re-verify with `npm view expo@sdk-57 version`, `npm view eas-cli version` and by reading
`node_modules/babel-preset-expo/build/plugins/inline-env-vars.js`.

## Contents

- Two kinds of variable
- How EXPO_PUBLIC_* is inlined (production, development, Jest)
- The one reader: src/config/
- Typing: src/env.d.ts
- .env files and NODE_ENV
- Server code: API routes and middleware
- EAS environments, eas.json env and eas update
- CI
- Disabling the mechanism

## Two kinds of variable

| | Build-time variables | `EXPO_PUBLIC_*` |
|---|---|---|
| Read by | `app.config.ts`, config plugins, build hooks, tools (Sentry upload, EAS CLI) | app code, through Metro |
| In the app binary | only what the config writes into native files or the public config | always: the value is inlined into the JS bundle |
| May hold a secret | yes, if no config field passes it into the app | no, never |
| Examples | `APP_VARIANT`, `SENTRY_AUTH_TOKEN`, `GOOGLE_SERVICES_JSON` (a file path) | `EXPO_PUBLIC_APP_VARIANT`, `EXPO_PUBLIC_API_URL` |

Expo's own words: "Do not store sensitive info, such as private keys, in `EXPO_PUBLIC_` variables.
These variables will be visible in plain-text in your compiled application."

## How EXPO_PUBLIC_* is inlined (production, development, Jest)

`babel-preset-expo` carries the plugin `expo-inline-or-reference-env-vars`. Read in the SDK 57 source:

- It rewrites a member expression on `process.env` whose property is an identifier or a string
  literal starting with `EXPO_PUBLIC_`. It is skipped for code in `node_modules`.
- **Production transforms** (`npx expo export`, a release build's bundling step, `eas update`) replace
  the expression with the value at transform time: `t.valueToNode(process.env[key])`. An unset
  variable becomes `undefined`, silently; nothing in the bundle shows it was missing.
- **Development transforms** (`npx expo start`) replace it with a reference into `expo/virtual/env`,
  which the dev server fills, so a changed value only needs a reload.
- **Jest** (jest-expo, `NODE_ENV=test`) takes the development path, and `expo/virtual/env` is
  `export const env = process.env;`. Tests therefore read the real `process.env` at run time: a test
  can set a variable on `process.env` and `currentAppVariant()` sees it. A non-public name read in app
  code also works in Jest, which is exactly why it slips through: in a release build it is `undefined`.

Only these forms are supported by the docs: `process.env.EXPO_PUBLIC_NAME` (and `?.`). The docs call
`process.env['EXPO_PUBLIC_NAME']` and `const { EXPO_PUBLIC_NAME } = process.env` invalid; the SDK 57
plugin happens to fold a string-literal bracket too, but nothing promises that, and ESLint's
`expo/no-dynamic-env-var` and `expo/no-env-var-destructuring` (on in `eslint-config-expo`) report the
narrow cases they see. `check-env` (`env-reader`) reports every form outside the supported one.

`NODE_ENV` and `EXPO_OS` are inlined by Expo's preset and Metro in every bundle; reading them anywhere
is fine.

The inlined values are part of the transformed code but not of Metro's cache key: see
[stripping-test-code.md](stripping-test-code.md) for the verified consequence and the fix.

## The one reader: src/config/

Every environment value app code needs is read in `src/config/`, in a typed module, and imported from
there:

- `src/config/current-app-variant.ts`: `currentAppVariant()` parses `EXPO_PUBLIC_APP_VARIANT` with
  `parseAppVariant`, so an impossible value fails loudly at startup instead of half-working.
- `src/config/environment.ts` (shape in `examples/environment.ts`): one function that lists every other
  public variable by its literal name, validates it with valibot, and returns a frozen object.

Why one place: a reviewer sees every public value in one file; `src/env.d.ts` and the reader change in
the same commit; the variant has one source of truth. The ESLint config already keeps remote URLs to
`src/api/` and `src/config/`, which matches.

What may depend on the variant at run time: labels (a Preview badge), the API environment, logging
verbosity, which test-only member to call (`TEST_ONLY?.x()`). What may not: whether code is in the
bundle at all (only the literal gate decides that).

## Typing: src/env.d.ts

`src/app-env.d.ts` (a canonical root file) declares `process` for the app program, which loads no
Node types. Each `EXPO_PUBLIC_*` variable is declared in `src/env.d.ts`, which both TypeScript programs
read:

```ts
declare namespace NodeJS {
  interface ProcessEnv {
    readonly EXPO_PUBLIC_APP_VARIANT?: string;
    readonly EXPO_PUBLIC_API_URL?: string;
  }
}
```

Without the line, dot access fails with TS4111 (`noPropertyAccessFromIndexSignature`) in the root
program and TS2339 in the app program. Declare it as optional `string`: the value can be missing, and
the reader validates it.

## .env files and NODE_ENV

Expo CLI loads `.env` files into its own process for every command (`start`, `export`, `config`,
`prebuild`, `run`) using the standard dotenv order: `.env.<NODE_ENV>.local`, `.env.local`,
`.env.<NODE_ENV>`, `.env`. A variable already set in the environment is never overridden by a file.

- Commit `.env.example` only: names, comments, no values (`templates/dot-env.example`). The canonical
  `.gitignore` ignores `.env*`, so add `!.env.example`.
- Keep local values in `.env.local` (ignored). `eas env:pull --environment development` writes it from
  the EAS environment (plain-text and sensitive variables only; secret ones never leave EAS).
- Do not pick environments with `NODE_ENV` or a `.env.staging`: `npx expo export` always forces
  `NODE_ENV=production`, and `eas update` runs `expo export` (Expo docs). The variant and the EAS
  environment are the switch.
- EAS CLI does not load `.env` files when it resolves the config for `eas build`; set the variables in
  the profile `env` or the EAS environment.

## Server code: API routes and middleware

Expo Router API routes (`src/app/**/<name>+api.ts`) and server middleware (`src/app/+middleware.ts`,
experimental) run on the server, never in the app bundle: "All the code in your API routes (files
ending with **+api.ts**) runs on the server" (Expo docs, EAS Hosting environment variables). On SDK 57
both need `web.output: "server"` (details in secrets.md). They are the Expo place for a runtime
secret the app needs, such as an LLM or payment provider key:

- The route reads the secret from `process.env` at request time (`process.env.OPENAI_API_KEY`), under a
  name without `EXPO_PUBLIC_`. Every form works there (dot, brackets, destructuring), because the
  server's environment is real, not inlined. `check-env` therefore exempts these files from
  `env-reader`; it still reports an `EXPO_PUBLIC_` secret name in them (`public-env-secret`), because
  that name would also be inlined into any app code that reads it.
- Helpers only routes import (an LLM client, a payment wrapper) live in a server folder that the
  repo file `rn-skills.config.json` names: `{ "serverDirs": ["src/server"] }`. `check-env` exempts
  those folders from `env-reader` like the routes, and reports app code that imports from them
  (`server-import`): bundled into the app, their `process.env` reads are `undefined`, and their code
  ships to every user.
- The app calls the route through its `ApiClient` (`networking-and-server-state`) and never sees the key.
- Locally, `npx expo start` serves the routes with values from `.env.local`.
- Deployed, the values come from an EAS environment: `npx expo export --platform web` (it sets
  `NODE_ENV=production`, so export the variant pair too), then `eas deploy --environment production`,
  which "will include all variables for the given environment ... in the API routes". Only plain-text
  and sensitive variables are included: "Secrets cannot be deployed with EAS Hosting" (Expo docs),
  and eas-cli 24.10.0 reads them with `environmentVariablesIncludingSensitive`
  (`build/worker/assets.js`, `createManifestAsync`). So a route's key is a **sensitive** EAS variable:
  `eas env:set --name OPENAI_API_KEY --environment production --visibility sensitive`.
- Expo's official `eas-hosting` skill is the reference for writing routes and deploying them.

## EAS environments, eas.json env and eas update

EAS has three built-in environments, `development`, `preview` and `production`. Each EAS variable has a
visibility:

| Visibility | Readable in | Use for |
|---|---|---|
| plain text | dashboard, EAS CLI, job logs | `APP_VARIANT`, `EXPO_PUBLIC_*` |
| sensitive | EAS CLI (obfuscated in logs) | values tools need locally, such as a source-map upload token you also use on your machine |
| secret | EAS servers only | build-time secrets: `SENTRY_AUTH_TOKEN`, `NPM_TOKEN`, a `GOOGLE_SERVICES_JSON` file |

How each command gets its variables:

| Command | Variables come from |
|---|---|
| `eas build --profile <p>` | the profile's `env` (committed plain text) plus the EAS environment named by the profile's `environment`; config resolution in EAS CLI sees plain-text and sensitive ones, not secret ones; on a name in both, the profile's value wins |
| `eas update --environment <e>` | the EAS environment's plain-text and sensitive variables only; `.env` files are switched off (`EXPO_NO_DOTENV=1`), eas.json `env` is not used, and the Metro cache is cleared |
| `eas update` without `--environment` | no EAS variables at all; Expo CLI loads the `.env` files of the machine; the Metro cache is reused. On SDK 55+ EAS CLI prompts for an environment outside CI, but the answer only labels the update; with `CI` or `EAS_BUILD` set it does not even ask |
| `eas deploy --environment <e>` (API routes on EAS Hosting) | the project's `.env` files, then the EAS environment's plain-text and sensitive variables, which win on a conflict (eas-cli 24.10.0 `createManifestAsync`) |
| `eas submit`, `eas metadata:push` | no profile env and no EAS environment for the config: only what the shell exports (see variant-matrix.md, "EAS commands that read the config outside a build") |
| `eas env:exec <environment> '<command>'` | the EAS environment's non-secret variables, for one command |
| Workflows build job | the build profile's `environment`; update and custom jobs default to `production` unless set |

Hence rule 4: the profiles set both variant variables (reviewed in git, checked by `check-variants`),
and the same two exist as plain-text variables in each EAS environment so updates get them too. Read
in eas-cli 24.10.0 (`build/build/evaluateConfigWithEnvVarsAsync.js`, `build/commands/update/index.js`,
`build/update/utils.js`):

- **The profile wins.** EAS CLI merges `{ ...EAS environment, ...profile env }` and warns on every
  build: `The following environment variables are defined in both the "production" build profile
  "env" configuration and the "production" environment on EAS: APP_VARIANT, EXPO_PUBLIC_APP_VARIANT.
  The values from the build profile configuration will be used.` With equal values the warning is
  expected and harmless; it is the price of having the variant both reviewed in git and available
  to `eas update`.
- **Always pass `--environment` to `eas update`.** Only the flag loads the EAS variables, turns `.env`
  files off and clears the cache. `environmentFlagNeededForSdk550OrGreater` skips its prompt whenever
  `CI` or `EAS_BUILD` is set, and a value picked at the prompt is stored on the update but never
  reaches the export. Without the flag, a CI update gets nothing from EAS (the resolver stops it
  unless the job exports the variant, and every other public value kept in EAS is `undefined`), a
  local one bundles whatever `.env.local` holds, and both reuse a warm Metro cache.
- **Publish every update with the build's own variant.** `eas update --environment <e>` for the
  environment whose `APP_VARIANT` the binary was built with. After a downloaded update,
  `Constants.expoConfig` is the update's `extra.expoClient` (expo-constants 57.0.20), so an update
  published with another variant swaps the app's name, link schemes and hosts (deep-links-and-universal-links
  relies on this guarantee); and each variant has its own fingerprint runtime, so it targets a runtime
  no binary of that channel has (ota-updates measured it).

Re-verify with `npm pack eas-cli@24.10.0 && tar -xzf eas-cli-24.10.0.tgz` and
`grep -n "build profile configuration will be used" package/build/build/evaluateConfigWithEnvVarsAsync.js`.

Commands for the developer to run in their account (stop and ask first; these change shared state):

```sh
for e in development preview production; do
  eas env:set --name APP_VARIANT --value $e --environment $e --visibility plaintext
  eas env:set --name EXPO_PUBLIC_APP_VARIANT --value $e --environment $e --visibility plaintext
done
eas env:set --name SENTRY_AUTH_TOKEN --environment production --visibility secret   # prompts for the value
eas env:list production                                                              # verify
```

`eas env:set` creates or updates a variable. `eas env:create` and `eas env:update` still exist in
EAS CLI 24.10.0 but are hidden and print "This command is deprecated. Use eas env:set instead."
(`build/commands/env/create.js`, `update.js`); `eas env:delete`, `eas env:get`, `eas env:pull` and
`eas env:push` complete the set. Verified in the published eas-cli 24.10.0 package; re-verify with
`eas env:set --help` from a global install (`npm install -g --min-release-age=7 --ignore-scripts
eas-cli@<x.y.z>`). Inside an app whose `.npmrc` sets `strict-allow-scripts=true`, `npx eas-cli@latest`
stops with ESTRICTALLOWSCRIPTS, because the root `allowScripts` does not cover npx's temporary install
(dependency-management explains the rule).

Built-in variables on EAS Build workers include `CI=1`, `EAS_BUILD=true`, `EAS_BUILD_PLATFORM`,
`EAS_BUILD_PROFILE`; they are not set when the config is resolved locally. `resolveAppVariant` reads
`EAS_BUILD` to refuse an unset variant on a worker.

## CI

- A CI job that builds or exports names its variant at job level:
  `APP_VARIANT: preview` and `EXPO_PUBLIC_APP_VARIANT: preview` (GitHub Actions `env:`).
- Jobs that only run typecheck, lint, Jest or knip need nothing: unset is development outside a
  production bundle.
- CI secrets (GitHub Actions secrets) are for tools that run in CI (`EXPO_TOKEN` for EAS CLI, a Sentry
  token). A secret set on GitHub Actions does not reach an EAS Build worker; EAS reads only its own
  environments (Expo FAQ).
- `ci-pipeline-and-gates` owns the workflow files.

## Disabling the mechanism

`EXPO_NO_DOTENV=1` stops Expo CLI from loading `.env` files; `EXPO_NO_CLIENT_ENV_VARS=1` stops the
inlining. Neither is part of this setup; they help when diagnosing which source a value came from.
