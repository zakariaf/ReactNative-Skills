# When multi-package

Most apps are one Expo app at the repo root, and every other reference assumes that. Read this only when
the repo holds several apps or shared packages in npm workspaces: the shape, the manifests, how every tool
reads TypeScript-source packages, one React, native modules in every app, and the zones across
workspaces. Moving to a monorepo is an architecture decision: stop and ask first.

## Contents

- The shape
- Recording the packages
- Manifests
- Packages are consumed as TypeScript source
- One React, and native modules in every app
- Zones across workspaces
- What the checkers prove

## The shape

```
<repo>/
  package.json            "workspaces": ["apps/*", "packages/*"], "overrides": { react, react-native }
  contracts/architecture.json   every package under packages/, with its world
  apps/<app>/             one Expo app each, with the single-app layout inside (src/app, src/features, ...)
    package.json  app.config.ts  tsconfig.json ("@/*": ["./src/*"])  metro.config.js
  packages/<name>/        shared TypeScript source: package.json, src/
```

Each app keeps every single-app rule inside its own folder (its `src/` zones, its routes, its composition
root). Package names use one scope, `@<org>/<name>`. Checkers find workspaces from `package.json`
`workspaces`, never from hard-coded folders, and give each workspace its own layout and tsconfig aliases
(`rn-skills.config.json` `workspaces` can move a workspace's folders).

## Recording the packages

`contracts/architecture.json` lists every folder under `packages/` (`examples/architecture-multi-package.json`):

| Field | Meaning |
|---|---|
| `name` | the folder name under `packages/` |
| `pure: true` | pure TypeScript: no framework packages; imports only itself and other pure packages (`core-pure`) |
| `world: "node"` | tooling: runs in Node; no app or package code imports it (`no-tooling-import`) |
| `exports` | the exact exports map when it is not `{ "./*": "./src/*" }` (a package that also exports `./plugins/*`) |

A package that is not recorded is a `workspaces` problem: a new package is a decision, not a side effect
of a refactor.

## Manifests

| Workspace | Load-bearing fields |
|---|---|
| root | `"private": true`, `"workspaces": ["apps/*", "packages/*"]`, `"overrides"` pinning `react` and `react-native` to the apps' versions, `engines` |
| `packages/<name>` | `"type": "module"`, `"exports": { "./*": "./src/*" }`, no `"main"` (no barrel: importers name the file), native modules as `"*"` `peerDependencies` |
| `apps/<app>` | `"main": "expo-router/entry"` (or the thin `index.ts`), no `"type": "module"` while `metro.config.js` is CommonJS, every native module of every package as a direct dependency |

Under `"type": "module"` Node treats `metro.config.js` as ESM and its `require()` fails; renaming the file
`metro.config.cjs` works when the app must be ESM (verified in a production Expo app, not re-run here;
`expo-doctor` still passed).

## Packages are consumed as TypeScript source

Nothing is compiled ahead of time; each tool reads `.ts` directly through the package's `exports`
(verified in a production Expo monorepo on SDK 57, Node 26.4, TypeScript 6.0.3; not re-run here):

| Tool | How `@<org>/ui/button.tsx` resolves |
|---|---|
| Metro (`expo export`, the native builds on iOS and Android) | the `node_modules/@<org>/ui` workspace symlink, then `exports` `"./*": "./src/*"`; Expo's monorepo defaults add the root to `watchFolders`; Babel and the React Compiler apply to package code |
| Jest (jest-expo) | the same symlink and `exports`; `transformIgnorePatterns` does not exclude workspace packages because their real path is outside `node_modules` |
| `tsc` (`moduleResolution: bundler`) | `exports` + `allowImportingTsExtensions`; one program per workspace |
| ESLint (`import/*` rules) | `eslint-import-resolver-typescript` through the same `exports` |
| Node (scripts, `app.config.ts`) | package self-reference through `exports`; the symlink resolves outside `node_modules`, so type stripping is allowed |

- **Node refuses to type-strip files inside a `node_modules` path.** Workspace packages work only because
  npm links them; never publish them or install them as tarballs.
- **Imports name the file with its extension** (`@<org>/core/money/format-price.ts`): `exports` maps
  `./*` without adding one. The canonical ESLint config enforces it when `IS_MULTI_PACKAGE` is on.

## One React, and native modules in every app

- One `react` and one `react-native` in the whole tree: without the root `overrides`, npm installed a
  second React at the root (pulled by a dev tool's peer) next to the app's, and Jest resolved the wrong one
  (verified in a production Expo app, not re-run here). `npm ls react react-native` shows exactly one version of each; an SDK
  upgrade moves the overrides in the same commit as the apps' versions (`one-react`).
- Every native module a package uses is a direct dependency of **every** app, at one version, and a
  `peerDependency` of the package (`native-deps`): autolinking (CocoaPods on iOS, Gradle on Android) and
  `npx expo install --check` read only the app's own `package.json`. Install with `npx expo install` inside
  the app.
- `npx expo config --json`, `npx expo install --check` and `npx expo-doctor` pass in every app.

## Zones across workspaces

```
apps/<a>  ──►  packages/*        apps never import each other (app-to-app)
packages/* ──►  packages/*        packages never import an app (package-direction)
pure packages ──► pure packages   only (core-pure)
nothing bundled ──► world "node" packages (no-tooling-import)
```

Inside each app the single-app zones apply with that app's folders: `apps/mobile/src/features/tasks`
never imports `apps/mobile/src/features/lists`, and so on. Vendor SDKs stay in adapters in packages too
(`packages/<name>/src/services/<concern>/*-adapter.ts`), and every SDK a package imports needs the same
classification (`vendorSdks` or `portlessSdks`) as in an app.

## What the checkers prove

| Rule | Checker | Catches |
|---|---|---|
| `workspaces` | check-layout | `workspaces` other than `["apps/*", "packages/*"]`, no contract, a package not recorded |
| `manifest` | check-layout | a package without `"type": "module"` or its exports map, with `"main"`; an app without `"main"` or with `"type": "module"` next to `metro.config.js` |
| `one-react` | check-layout | `overrides` missing or not equal to the apps' `react` / `react-native` |
| `native-deps` | check-layout | a package peer missing from an app; apps pinning different versions |
| `app-to-app`, `package-direction` | check-boundaries | cross-app and package-to-app imports, resolved through workspace names |
| every single-app rule | both | inside each app, with its own layout |
