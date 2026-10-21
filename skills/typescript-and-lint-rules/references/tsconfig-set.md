# The tsconfig set: one base, two programs

Why an Expo app has two TypeScript programs on one strict base, what each compiler option buys, and
the rules for code that Node runs. Read this before creating or changing any tsconfig, when `tsc`
reports a missing global (`process`, `node:fs`), or when a file seems to be checked by the wrong
program.

## Contents

- Two worlds, two programs
- The files
- How tsc, ESLint, Jest and Expo find a file's program
- What each compiler option buys
- `process.env` in app code: app-env.d.ts
- Typed routes and expo-env.d.ts
- Aliases
- Node-run code (app.config.ts, config plugins, scripts)
- When multi-package
- Verified facts

## Two worlds, two programs

Code lives in one of two worlds, and the app world never reaches into the other.

| World | Where | Types | Runs in |
|---|---|---|---|
| App | `src/**` (routes, features, ui, theme, core, services, stores, data, api, i18n, config) and the root `test/` helpers its tests import through `@test/*` | `jest` (no Node) | the app bundle (Hermes), Jest |
| Node | `app.config.ts`, `plugins/**`, `scripts/**`, `jest.setup.ts`, `__mocks__/**` | `node` + `jest` | Node 22.18 or newer with type stripping, Jest |

- **The app program** (`src/tsconfig.json`) proves that app code compiles without Node: no `process`
  beyond what `src/app-env.d.ts` declares, no `node:fs`, no `Buffer`.
- **The root program** (`tsconfig.json`) checks the whole repo, app code included, with Node and Jest
  types. It is the program for config, plugins, scripts, mocks and the Jest setup.
- App code never imports a Node-world file, not even with `import type`: a type-only import still
  pulls the file into the app program, where its `process` and `node:fs` do not type-check, and a
  value import pulls Node code into the bundle. `check-source.mjs` reports it (`node-world-import`)
  before tsc runs. A type both worlds need goes in a neutral file under `src/` that imports nothing
  from Node or React Native (for example `src/config/app-variant.ts`), and both sides import it.

## The files

| File | Template | `types` | Covers |
|---|---|---|---|
| `tsconfig.base.json` | `templates/tsconfig.base.json` | `[]` | compiler options only; extends `expo/tsconfig.base` |
| `tsconfig.json` | `templates/tsconfig.json` | `jest`, `node` | `**/*.ts`, `**/*.tsx`, `.expo/types/**/*.ts`; excludes native and build folders, `skills`, `expo-env.d.ts`, `src/app-env.d.ts` and every pre-existing top-level folder |
| `src/tsconfig.json` | `templates/src/tsconfig.json` | `jest` | `**/*` under `src/`, `../.expo/types/**/*.ts` |

Rules for these files (`check-configs.mjs`, `tsconfig-*` rules):

- `tsconfig.base.json` holds exactly the options in the table below (plus `incremental` and
  `tsBuildInfoFile`). A new option, or a member of `strict` set to `false` (`noImplicitAny`,
  `strictNullChecks`, `strictFunctionTypes`, ...), changes the guarantees of every program:
  `check-configs` fails it (`tsconfig-base-option`), and adding one is a stop-and-ask decision. Its
  only top-level keys are `$schema`, `extends` and `compilerOptions`: an `include`, `exclude`, `files`
  or `references` there is inherited by every program that sets none (a base `exclude` of
  `${configDir}/features` quietly drops unimported feature files from the app program).
- Every program extends `tsconfig.base.json` and sets only `types`, `paths`, `tsBuildInfoFile`,
  `include` and `exclude`. `paths` is per program because each resolves it relative to itself;
  `tsBuildInfoFile` because `${configDir}` differs per program (below).
- No program sets `lib`: the Expo base gives `["DOM", "ESNext"]` to both (`tsconfig-world`).
- The app program (`src/tsconfig.json`) excludes nothing: a folder excluded there loses the
  no-Node-types guarantee while the root program still checks it with Node types (`tsconfig-world`).
- No `exclude` entry of the root program reaches app code (`src/`, `test/`, `scripts/`, `plugins/`,
  `app.config.ts`); only `src/app-env.d.ts` and pre-existing folders go there (`ignore-app-code`).
- Each top-level folder that predates the app (`handbook/`, design exports, notes) is in the root
  `exclude` (`"handbook"`), next to its entries in ESLint's `PRE_EXISTING` and `.prettierignore`. The
  root `include` is `**/*.ts`, so a forgotten `.ts` script in such a folder is type-checked under the
  strict set and `npm run typecheck` fails (TS1294 under `erasableSyntaxOnly`, implicit `any`) while
  ESLint and Prettier skip it. `check-configs` reports it (`ignore-pre-existing`, file `tsconfig.json`).
- `npm run typecheck` runs `tsc --noEmit -p tsconfig.json && tsc --noEmit -p src/tsconfig.json`.
- `tsconfig.stryker.json` (mutation testing) extends the same base; unit-and-component-tests owns it.

## How tsc, ESLint, Jest and Expo find a file's program

- **tsc** checks each program on its own. `incremental` with build info under
  `node_modules/.cache/tsc/` makes a warm run take about a second. The app program points its build
  info at the root cache (`${configDir}/../node_modules/...`): `${configDir}/node_modules/...` would
  create a stray `src/node_modules/`.
- **ESLint's projectService** (and the editor) picks the nearest `tsconfig.json` that includes the
  file: `src/**` files get the app program, everything else the root program. The import resolver
  lists both (`import/resolver.typescript.project`). A new top-level folder with `.ts` files is
  covered by the root `**/*.ts`; a folder that must stay out (a pre-existing one) goes in its
  `exclude`.
- **Jest** (jest-expo) derives the `@/` mapper from `tsconfig.json` in the working directory only,
  not through `extends`, so `jest.config.js` spells the aliases out (unit-and-component-tests owns
  it) and the root `tsconfig.json` keeps its own `paths`.
- **Expo CLI** reads the root `tsconfig.json` and, with typed routes on, edits its `include` (next
  sections).

## What each compiler option buys

| Option | What it catches, and the usual fix |
|---|---|
| `strict` | the baseline: `strictNullChecks`, `noImplicitAny` and the rest |
| `noUncheckedIndexedAccess` | `list[index]` and `record[key]` are `T \| undefined`: `const task = tasks[0]; if (task === undefined) return ...;` or `?? fallback` |
| `exactOptionalPropertyTypes` | a missing field differs from one set to `undefined`. Pass optional props with a conditional spread: `{...(testID === undefined ? {} : { testID })}` |
| `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch` | a forgotten `override`, a missing `return`, a silent `case` fall-through |
| `noPropertyAccessFromIndexSignature` | `record.key` on an index signature is written `record['key']`; a declared `EXPO_PUBLIC_*` variable keeps dot access |
| `erasableSyntaxOnly` | no `enum`, `namespace` or constructor parameter properties: every file stays runnable by Node type stripping |
| `verbatimModuleSyntax`, `isolatedModules` | `import type` for types, which single-file transforms (Babel, Metro, Node) need |
| `allowImportingTsExtensions` | lets Node-run files write `./x.ts`; fine because `noEmit` comes from the Expo base |
| `useUnknownInCatchVariables` | `catch (error)` is `unknown`; narrow with `error instanceof Error` before reading `.message` |
| `allowUnreachableCode: false`, `allowUnusedLabels: false`, `forceConsistentCasingInFileNames` | dead code, stray labels, case-only import mismatches (macOS ignores case, Linux CI does not) |
| `noErrorTruncation` | full types in error messages, so the whole mismatch is visible |
| `customConditions: ["react-native-strict-api", "react-native"]` | React Native's Strict TypeScript API. Setting the option replaces the base array, so `react-native` stays listed |
| `types: []` | TypeScript 6 loads no `@types` package by default; each program lists exactly what it may use (`jest` needs `@types/jest`, `node` needs `@types/node`; a missing one is TS2688 "Cannot find type definition file") |

TypeScript does not report unused locals or parameters (`noUnusedLocals`, `noUnusedParameters` stay
off; `check-configs` fails them). ESLint's `@typescript-eslint/no-unused-vars` is the one reporter, so
`_`-prefixed parameters work and there is never a second opinion.

## `process.env` in app code: app-env.d.ts

Expo inlines `EXPO_PUBLIC_*` variables only for dot access (`process.env.EXPO_PUBLIC_API_URL`). The app
program has no `@types/node`, so `src/app-env.d.ts` declares `process`
(`declare const process: { readonly env: NodeJS.ProcessEnv }`). Each `EXPO_PUBLIC_*` variable is
declared in `ProcessEnv` in `src/env.d.ts`, which both programs read (app-variants-and-environment owns
the variables); declared only in `app-env.d.ts`, the root program fails dot access with TS4111.

Keep `app-env.d.ts` out of the root program: there its `process` replaces `@types/node`'s
(`skipLibCheck` hides the clash) and `process.exitCode` or `process.cwd()` fail with TS2339
(re-verified 2026-10-03). Use `declare const`, not `declare var` (`no-var`).

## Typed routes and expo-env.d.ts

With `experiments.typedRoutes` on, `expo start` generates `.expo/types/router.d.ts` (a global
augmentation of `expo-router`), writes `expo-env.d.ts` (`/// <reference types="expo/types" />`), adds
it to `.gitignore`, and appends `.expo/types/**/*.ts` and `expo-env.d.ts` to the root
`tsconfig.json` `include` when they are missing (read in `@expo/cli` 57.0.27,
`start/server/type-generation/tsconfig.js`).

- `expo/types` augments React Native with web props and breaks `Text` props and styles under the
  Strict TypeScript API (TS2344/TS2322 in `AppText`, re-verified on Expo SDK 57.0.26). So the root
  `tsconfig.json` lists `expo-env.d.ts` in `include` (Expo then has nothing to add to a gated file)
  and in `exclude` (it never enters a program), and the app program never includes it
  (`tsconfig-expo-env`).
- A global augmentation that nothing imports reaches a program only through `include`. The app
  program lists `../.expo/types/**/*.ts`; without it every `href` is a plain string there while the
  root program checks typed routes, and the two disagree (`tsconfig-world`).
- `.expo/types` exists only after `expo start`; in CI it is absent and `Href` is a plain string. That
  is expected: typed routes catch mistakes on the developer's machine.
- These rules assume typed routes on (the canonical stack). With them off, Expo CLI removes the two
  `include` entries and `check-configs` asks for them back; turn typed routes on.

## Aliases

Both programs map `@/*` to `src/*` and `@test/*` to `test/*`, each relative to its own folder
(`./src/*` in the root, `./*` in `src/tsconfig.json`). An alias that differs between them makes an
import type-check in one program and fail in the other; `check-configs` compares the resolved targets
(`tsconfig-alias`). Relative imports are for siblings only (`./x`); parent-relative imports are
banned in app code (references/code-policies.md, "Imports").

## Node-run code (app.config.ts, config plugins, scripts)

Node 22.18 or newer runs `.ts` files directly by stripping types (`engines` requires it). That
imposes five rules on `app.config.ts`, `plugins/**` and `scripts/**`:

1. Relative imports carry the extension (`./with-task-widget.ts`): Node resolves nothing without it
   and reads no tsconfig `paths`, so Node code cannot use `@/` and may use `../`. ESLint's
   `NODE_IMPORT_EXTENSION` selector and `check-source.mjs` (`import-extension`) enforce it.
2. Only erasable TypeScript syntax (`erasableSyntaxOnly` guarantees it).
3. `scripts/package.json` declares `"type": "module"`, so Node does not warn
   `MODULE_TYPELESS_PACKAGE_JSON` and scripts are ESM.
4. Testable logic lives in pure modules without top-level side effects; a thin CLI file wraps them
   and sets `process.exitCode`. Jest transforms these modules with Babel, so pure modules do not use
   `import.meta`.
5. A deep import into a package without an `exports` map needs the file's `.js` extension under Node
   ESM: a config plugin imports `expo/config-plugins.js`, not `expo/config-plugins` (expo 57.0.26 has
   no `exports` map). Type-only imports (`import type { ExpoConfig } from 'expo/config'`) are erased
   and need nothing.

Node refuses to strip types inside a `node_modules` path; never publish TypeScript-source helpers as
packages or install them as tarballs.

## When multi-package

npm workspaces `apps/*` and `packages/*`, packages consumed as TypeScript source through
`"exports": { "./*": "./src/*" }`:

- The root keeps `tsconfig.base.json` and a root `tsconfig.json` for Node code and tests. Every
  workspace has its own `tsconfig.json` that extends the root base (`../../tsconfig.base.json`) and
  sets only `types`, `paths`, `include` and `exclude`; an Expo app workspace lists `["jest"]`, never
  `node` (`check-configs` checks every workspace from `package.json` `workspaces`).
- The root program still reads every workspace (`**/*.ts`), so each Expo app workspace's
  `app-env.d.ts` leaves it in its workspace form: `"exclude": [..., "apps/mobile/src/app-env.d.ts"]`
  next to the canonical `src/app-env.d.ts`. Without it the root program sees the app's
  `declare const process` in place of `@types/node`'s and fails with TS2339 on `process.exitCode`.
  `check-configs` requires the entry wherever the file exists (`tsconfig-world`) and counts it as
  canonical, never as an ignore that skips app code (`ignore-app-code`). A Node backend workspace
  (`functions/`, which declares `"engines": { "node": ... }`) is Node tooling and may list `node`.
  `check-source.mjs` treats it as Node-run code too, like `scripts/`: its `node:crypto` import is
  fine, while app code that imports one of its files fails `node-world-import`. It reads the backend
  from `package.json` `workspaces` (outside `packages/`, no Expo app) and from
  `contracts/architecture.json` (architecture-and-boundaries), where a workspace with `"world":
  "node"` (a server-only package) joins the Node world and `"world": "app"` keeps one in the app.
- An extensionless import does not resolve through an `exports` wildcard in `tsc`, so every relative
  and workspace import writes its extension (`./x.ts`, `@acme/ui/button.tsx`). Set
  `IS_MULTI_PACKAGE = true` in `eslint.config.mjs` and extend `PACKAGE_IMPORT_EXTENSION`'s pattern
  with the workspace scope; `check-source.mjs` checks every workspace import in monorepo mode
  (`"importExtensions": "all"`). The skills' templates import without extensions (the single-app
  style), so after copying templates into a workspace run `add-import-extensions.mjs . --path <folder>`:
  it rewrites each extensionless local import to the file it resolves to (`./x` to `./x.ts`, `@/i18n`
  to `@/i18n/index.ts`, `@acme/shared/core/result` to `@acme/shared/core/result.ts`) and refuses an
  import that resolves to platform files (`x.ios.ts`, or a plain `x.ts` beside one): Metro picks the
  platform file only for the extensionless form, so a person decides.
- A package that declares a global augmentation (React Navigation's `RootParamList`, a theme module
  declaration) must be listed in the `include` of every app program that imports files depending on
  it. Otherwise the augmentation is empty there and calls fail with TS2769 ("not assignable to
  parameter of type 'never'") while the package's own program is green, which makes the error look
  like a bug in the calling file.
- Workspace packages are linked by npm, so Node follows the link out of `node_modules` and type
  stripping works; never publish them.

## Verified facts

On 2026-10-03, in a copy of the reference Expo SDK 57 app (Node 26.4.0, npm 11.17.0, TypeScript 6.0.3,
ESLint 9.39.5, typescript-eslint 8.70.1, eslint-config-expo 57.0.2, React Native 0.86.3, React 19.2.3,
Jest 29.7 + jest-expo 57.0.5, Prettier 3.9.9):

- Both programs type-check the canonical templates and this skill's examples.
- Adding `../expo-env.d.ts` to the app program breaks `AppText` (TS2344, TS2322, TS2739).
- Dropping `src/app-env.d.ts` from the root `exclude` breaks `process.exitCode` and `process.cwd()`
  in Node files (TS2339).
- `@expo/cli` 57.0.27 appends `.expo/types/**/*.ts` and `expo-env.d.ts` to the root `include` on
  `expo start` with typed routes on, and removes both with them off.
- The multi-package facts (extensionless imports through an `exports` wildcard, TS2769 from a missing
  global augmentation) were verified on 2026-09-26 and 2026-09-29 in an npm-workspaces monorepo with
  the same versions.

Re-verify after an upgrade: `npm run typecheck` in a fresh app from expo-project-bootstrap, then add
`../expo-env.d.ts` to `src/tsconfig.json` and confirm `tsc -p src/tsconfig.json` still fails.
