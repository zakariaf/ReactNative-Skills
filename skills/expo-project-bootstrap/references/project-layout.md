# The project layout the bootstrap creates

What the repository looks like right after the bootstrap, what it deliberately leaves out and which
skill adds each part, who maintains each file afterwards, how pre-existing folders and template
leftovers are handled, and the fenced multi-package form. Read it before running the generator, and
again when a later skill asks where a file goes.

## Contents

- One app at the repo root
- The tree after the bootstrap
- What the bootstrap leaves out (and the order that adds it)
- Who maintains each file afterwards
- Pre-existing folders at the root
- Template leftovers
- When multi-package

## One app at the repo root

The default is one Expo app at the repository root: `app.config.ts`, `package.json` and the root
configs at the top, the app code in `src/` with the `@/` alias (`@/*` maps to `./src/*`, the Expo
template's alias; `@test/*` maps to `./test/*`), Expo Router's file routes in `src/app/`. Two
TypeScript programs: the root `tsconfig.json` (Node and tests, types `jest` and `node`) and
`src/tsconfig.json` (the app, types `jest` only, so no Node global reaches app code).
`npm run typecheck` runs both.

Why one app: most teams ship one app, and every tool (Metro, Jest, ESLint, knip, autolinking, EAS)
works without workspace configuration. Several apps sharing code is the fenced form at the end.

## The tree after the bootstrap

```
<repo>/
  package.json  package-lock.json  .npmrc  .nvmrc  .gitignore
  .prettierrc.json  .prettierignore  eslint.config.mjs  knip.json  lefthook.yml  quality-gates.json
  tsconfig.base.json  tsconfig.json  tsconfig.stryker.json
  babel.config.js  jest.config.js  jest.setup.ts  jest.sim.config.js  stryker.config.json
  app.config.ts      the only app config: three variants (development, preview, production)
  metro.config.js    Metro's cache keyed on every EXPO_PUBLIC_* value
  AGENTS.md  CLAUDE.md  .claude/settings.json
  contracts/         dependency-policy.json (the versions and the banned lists), knip-ignores.json (+ schema)
  assets/icons/<variant>/   icon.png and the three Android adaptive layers (placeholder art)
  assets/images/     splash-icon.png, favicon.png (placeholder art)
  scripts/           Node tooling run by type stripping: quality/ (the guardrail, verify, device-only),
                     hooks/ (after-edit, install-git-hooks), git/ (commit-msg check), deps/ (check:deps,
                     check:npm-config), audit/ (licences), clock/, metro/ (the cache key)
  src/
    tsconfig.json  app-env.d.ts  env.d.ts
    config/app-variant.ts (+ test)      the one variant resolver (config and bundle)
    app/_layout.tsx                     the starter root Stack (no animation yet)
    app/index.tsx                       the first route: renders the home screen, nothing else
    features/home/home-screen.tsx (+ test)   the starter screen, a pure view
  docs/ ...          anything that was there before (pre-existing, ignored by the tools)
```

`ios/`, `android/`, `node_modules/`, `.expo/`, `coverage/`, `reports/` and build output are
generated and git-ignored.

## What the bootstrap leaves out (and the order that adds it)

The skeleton holds only what its own configs and gates need, so every gate is green on day one and
no package ages unused. These arrive with the skill that first needs them, in this order (the order
react-native-conventions-index gives for a new app):

| Next | Skill | Adds |
|---|---|---|
| 1 | architecture-and-boundaries | the composition root (`src/services/`), ports and fakes, `contracts/architecture.json` |
| 2 | error-handling-typed-results | `src/core/result.ts`, the global error net, the root error boundary |
| 3 | i18n-strings-and-catalogs | catalogs, `t()`, the Intl polyfills and `index.ts` as the entry, `scripts/i18n/verify-catalogs.ts` (then `npm run verify` runs to the end) |
| 4 | rtl-and-direction | the direction gate and restart guard |
| 5 | design-system-structure | `src/theme/`, `AppText`, the light and dark sets |
| 6 | accessibility-as-code | `src/ui/a11y/`, the screen-test audit helper, contrast pairs |
| 7 | app-startup-and-bootstrap | replaces `src/app/_layout.tsx` with the canonical root skeleton (splash hold, providers, startup gate) |
| 8 | navigation-and-routing | `contracts/navigation.json` and the `+not-found` route |
| 9 | unit-and-component-tests | `test/render-with-providers.tsx` and `test/test-app.tsx` (the starter test marks itself `// no-providers:` until then) |
| 10 | motion-and-animation | the moment catalog; the stack's screen transition with the Reduce Motion answer |
| then | scaffold-feature-screen | the first real feature: delete `src/app/index.tsx` and `src/features/home/`, then generate it at `--route index` (or `"(app)/index"`) |
| when building | eas-build-and-submit | `eas.json` (one build profile per variant) and the first build |

Until its step, each of those skills' checkers reports its part as missing on a fresh skeleton
(first-install-and-verify.md lists the exact lines). That is the build order, not a bootstrap bug.
Packages follow the same rule: React Native Testing Library is in the skeleton (the starter test uses
it), `jest-image-snapshot` waits for the first pixel golden, everything else for its first importer,
installed through dependency-management at the policy's version.

## Who maintains each file afterwards

The bootstrap writes each file once; after that, change a file through the skill that owns it:

| Files | Maintained by |
|---|---|
| `package.json` scripts, `lefthook.yml`, `quality-gates.json`, `.claude/settings.json`, `scripts/quality/`, `scripts/hooks/`, `contracts/knip-ignores.json` (+ schema) | quality-gates |
| `tsconfig.base.json`, `tsconfig.json`, `src/tsconfig.json`, `src/app-env.d.ts`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `knip.json`, `.gitignore` | typescript-and-lint-rules |
| `.npmrc`, dependencies, `contracts/dependency-policy.json`, `scripts/deps/`, `scripts/audit/`, `scripts/clock/` | dependency-management |
| `jest.config.js`, `jest.setup.ts`, `jest.sim.config.js`, `stryker.config.json`, `tsconfig.stryker.json`, `scripts/package.json`, `scripts/quality/device-only.ts` | unit-and-component-tests |
| `babel.config.js`, the `app.config.ts` skeleton, `AGENTS.md`, `CLAUDE.md`, `.nvmrc` | this skill |
| `src/config/app-variant.ts`, `src/env.d.ts`, `metro.config.js`, `scripts/metro/`, the variant identities | app-variants-and-environment |
| `scripts/git/` | git-commits-and-reporting |
| the plugin list and native settings in `app.config.ts` | expo-prebuild-and-config-plugins |
| moving to the next Expo SDK | expo-sdk-upgrade |

Most of these are gated paths: a commit that changes them needs a `Gate-Change: <reason>` trailer,
and the agent settings' `ask` rules make the agent ask the developer before editing them.

## Pre-existing folders at the root

The folder may already hold hand-written material: knowledge folders, design exports, notes. Every
non-hidden top-level entry that is not part of an Expo app's layout is pre-existing. The layout names
are `src`, `app`, `assets`, `test`, `__mocks__`, `scripts`, `plugins`, `modules`, `contracts`,
`design`, `skills`, `apps`, `packages`, `patches`, the generated folders, the root configs, the
lockfiles and the usual repository files (`README.md`, `LICENSE`, `CHANGELOG.md`, `CONTRIBUTING.md`,
`SECURITY.md`, `CODE_OF_CONDUCT.md`): a superset of the app layout typescript-and-lint-rules'
check-configs reads (it adds the root files other skills write). Those root files are layout names
(`fingerprint.config.js` from ota-updates, `eas.json`, `store.config.json`, every `app.config.*` form
`@expo/config` loads), so the tooling keeps linting and formatting them. A second tool config
(`eslint.config.js`, `prettier.config.*`, ...) is never pre-existing: it is a leftover (below).
`docs/` is deliberately not one: it is the usual knowledge folder that predates the app. When
spec-traceability later creates `docs/spec/` in an app that had no `docs/`, add `docs/` to
`.prettierignore` and `'docs/**'` to `PRE_EXISTING` in that commit (ESLint and `tsc` never read its
Markdown anyway), or declare it
in `"layoutEntries"` when the team wants Prettier to format it.
For each pre-existing entry the generator:

- adds `<folder>/` (or the file name) to `.prettierignore`, so `format:check` never reformats the
  developer's files;
- adds `'<folder>/**'` to `PRE_EXISTING` in `eslint.config.mjs` (one line while it fits Prettier's
  100 columns, else one entry per line), so ESLint never lints tools or scripts in it;
- adds the name to the root `tsconfig.json` `exclude` when it holds `.ts`/`.tsx` files, because the
  root program includes every `**/*.ts`.

An app nested inside a larger git repository (its folder is not the git top level) keeps the
skeleton as it is: `prepare` skips the hook install by itself there, and `rn-skills.config.json` may
say `"agentInstructions": "parent-repo"` when the enclosing repository's root holds `AGENTS.md`, and
`"lefthookPrepare": "parent-repo"` when that repository installs the hooks (quality-gates). The
checker looks for that `AGENTS.md` only from the app's parent folder up to the enclosing repository's
top level (the first ancestor holding `.git`), and never at or above the home folder: an unrelated
`~/AGENTS.md` or `/tmp/AGENTS.md` does not count, and an app folder that is itself the git top level
has no parent repository.

A folder that is app code (a tool config the app runs, code it imports) is not pre-existing: move it
under `src/`, or declare it in `rn-skills.config.json` `"layoutEntries"` so it stays linted,
formatted and type-checked. The same goes for a moved contracts folder: with `"contractsDir":
"qa/contracts"` the checker expects `qa/contracts/dependency-policy.json` and
`qa/contracts/knip-ignores.json` (a `"dependencyPolicy"` path wins for the policy, as in the app's own
dependency scripts), and `"layoutEntries": ["qa"]` keeps `qa/` from being treated as pre-existing. A folder added at the root later gets a place in the layout, or joins the
three ignore lists with a `Gate-Change:` trailer. Installed agent skills (`skills/`, `.agents/`,
`.claude/`) are ignored by every tool already: their templates and fixtures hold planted bugs and
`package.json` files on purpose.

## Template leftovers

Running the generator on top of `create-expo-app`'s default template (SDK 57) plans every skeleton
file and reports each demo file as `leftover`: `app.json` (Expo merges it into `app.config.ts`, so a
value there silently changes the config), `scripts/reset-project.js` and `app-example/`,
`src/app/explore.tsx` (the demo tab), `src/components/`, `src/constants/`, `src/global.css`,
`src/hooks/use-color-scheme.ts` (+ `.web.ts`), `src/hooks/use-theme.ts`, the root `assets/expo.icon/`
(its Icon Composer icon) and its demo art in `assets/images/` (`icon.png`, `android-icon-*.png`,
`react-logo*.png`, `expo-logo.png`, `expo-badge*.png`, `logo-glow.png`, `tutorial-web.png`,
`tabIcons/`), 23 leftovers in all (expo-template-default 57.0.30 on 2026-10-14; the same 23 and 4
conflicts on 57.0.32 on 2026-10-16). Its
`splash-icon.png` and `favicon.png` stay: the skeleton's `app.config.ts` uses both, so the generator
keeps the existing images. From older templates
`components/`, `constants/`, `hooks/` at the root, and a root `app/` next to `src/app/` (Expo Router
reads `src/app` whenever it exists, so a root `app/` beside it is never routed). Move what the app
still needs (a value of `app.json` into `app.config.ts`, a component into `src/ui/` through
ui-component-library), delete the rest.

A second tool config at the root is a leftover too, never a pre-existing entry: `eslint.config.js`
(which `npx expo lint` writes in an existing Expo app), `.eslintrc*`, `prettier.config.*`,
`.prettierrc*` other than `.prettierrc.json`, `knip.ts`/`knip.jsonc`/`.knip.json`. Each is loaded by
its tool, so putting it in an ignore list changes nothing: ESLint 9 loads `eslint.config.js` before
`eslint.config.mjs`, and the canonical config quietly never runs. Move any rule the team needs into
the canonical file through typescript-and-lint-rules, then delete the stray one (the same names as
that skill's `config-stray` rule).
`check-skeleton.mjs` reports the same list (`template-leftover`). The template's own
`src/app/_layout.tsx`, `src/app/index.tsx`, `tsconfig.json` and `package.json` are conflicts: read
them, keep nothing the skeleton replaces, rerun with `--replace`.

Re-verify the list when Expo publishes a new template (each in a new empty folder; the package
stores `gitignore` and `_vscode`, which create-expo-app renames to `.gitignore` and `.vscode`):

```sh
mkdir pack app && (cd pack && npm pack expo-template-default@57)
tar -xzf pack/expo-template-default-*.tgz -C app --strip-components 1
mv app/gitignore app/.gitignore && mv app/_vscode app/.vscode
node ${CLAUDE_SKILL_DIR}/scripts/scaffold-app.mjs app --app-id com.acme.tasks --name Tasks
```

The dry run must list every demo file as `leftover` or `conflict` and print `pre-existing ... none`;
a template file it plans as neither is new demo content: add it to `LEFTOVERS` in
`scripts/lib/bootstrap-plan.mjs` with its reason, and update the count above.

## When multi-package

For several apps that share code: npm workspaces `"workspaces": ["apps/*", "packages/*"]`, each app
an Expo app in `apps/<app>` (its own `package.json`, `app.config.ts`, `metro.config.js`,
`tsconfig.json`, `src/`, `assets/`), shared code in `packages/<name>` consumed as TypeScript source.

How to get there: bootstrap the single app first (every gate green), then move `app.config.ts`,
`metro.config.js`, `src/` and `assets/` into `apps/<app>/`, give the app its own `package.json` with
the runtime dependencies, and leave the root configs, `scripts/`, `contracts/` and the dev tools at
the root. `scaffold-app.mjs` writes only the single-app form; run it inside `apps/<app>` for a second
app's files and merge by hand. The rules that hold there, each checked by `check-skeleton.mjs` when
`package.json` has `workspaces`:

- **Every workspace is declared and has its own program** (`workspace-layout`): a folder under a
  workspace parent with a `package.json` that no glob matches is never linked or installed. Its
  `tsconfig.json` extends the root `tsconfig.base.json` and sets only `types`, `paths`, `include`,
  `exclude` (`tsconfig-program`, for apps and shared packages alike); an app lists `["jest"]`, never
  `node`. A shared package lists its `types` too (without the list TypeScript loads every installed
  `@types` package, `@types/node` included) and never `node`, unless it is Node tooling: its
  `package.json` declares `"engines": { "node": ... }` or a `"bin"`. Adding a package is an
  architecture decision: ask first.
- **Per-workspace layout keys are relative to the workspace.** `rn-skills.config.json`
  `"workspaces": { "apps/tasks": { "routesDir": "app" } }` puts that app's routes in
  `apps/tasks/app`; the per-app checks (root layout, app-variant, env types, leftovers) follow it.
- **Shared packages are TypeScript source** (`package-manifest`): private, named `@<org>/<name>` in
  one scope, `"exports": { "./*": "./src/*" }`, no build step, no barrel. An extensionless import does
  not resolve through an `exports` wildcard in `tsc`, so workspace imports write their extension
  (typescript-and-lint-rules, When multi-package).
- **The root holds no app runtime** (`root-runtime`): `expo`, `react-native` and native modules live
  in each app (autolinking and `npx expo install --check` read only the app's own dependencies); the
  root pins React and React Native through `overrides`.
- **One version of everything native** (`root-overrides`, `app-lockstep`): `overrides` pins `react`
  and `react-native` at the apps' exact versions and every `"*"` peer of a shared package at the
  version the apps install. A `"*"` peer is satisfied by any release, so without the override npm may
  put its newest one at the root next to the app's SDK pin (seen: `react-native-screens` 4.28.0 beside
  the app's 4.26.2); JavaScript then resolves one copy while autolinking builds the other, and
  expo-doctor reports duplicate native modules. Every app declares a shared dependency at the same
  specifier.
- **Workspace links are `"*"`** (`app-manifest`), apps have no `"type"` (their `metro.config.js` is
  CommonJS), and `knip.json` sets `includeEntryExports: true` per shared package (its `exports` map
  makes every file an entry, so a dead file is never reported otherwise; `knip-config`).
- Each app's generated native folders join `.gitignore` and `.prettierignore` (`apps/*/ios`,
  `apps/*/android`).
