# TypeScript and ESLint

Compiler and lint errors seen with the strict TypeScript 6 setup and the ESLint 9 flat config, and the config bugs found while verifying them. Match the text you see in the Symptom column, or run `find-fix.mjs --text "<first error line>"`.

Status: **verified** = seen and fixed in a real run; **documented** = read in the tool's own source or docs; **open** = not settled, the fix is the current fallback. **needs a human** = a stop: send one message and wait, never work around it. Platform: blank = both. Skill = where the full procedure lives. Reviewed on 2026-10-17 against Expo SDK 57 (expo 57.0.27), React Native 0.86.3, React 19.2.3, Xcode 26.6, Android compileSdk and targetSdk 36, Jest 29.7, Maestro 2.10; re-verify the versions with `npm run -s typecheck && npx eslint . --max-warnings 0`.

<!-- Generated from assets/known-failures/lint.json by scripts/check-catalogue.mjs --write. Edit the JSON, not this file. -->

## Contents

- TypeScript
- ESLint config
- Naming
- Components

## TypeScript

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `lint-ts2593-jest-types` | TS2593: Cannot find name 'describe' | TypeScript 6 defaults types to [], so the Jest globals are unknown | Give the test programs types: ["jest"] (the root program ["jest", "node"]) | verified |  | `typescript-and-lint-rules` |
| `lint-ts2591-process` | TS2591: Cannot find name 'process' (or a node: module) in app code or scripts | The program has no Node types | App code: src/app-env.d.ts declares process for EXPO_PUBLIC_* (never add Node types to app code); Node scripts: the root program with types node | verified |  | `typescript-and-lint-rules` |
| `lint-ts4111-env` | TS4111 on process.env.EXPO_PUBLIC_APP_VARIANT or process.argv | noPropertyAccessFromIndexSignature requires bracket access unless the property is declared | Declare every EXPO_PUBLIC_* in src/env.d.ts (Expo inlines only dot access); use bracket access in Node code | verified |  | `typescript-and-lint-rules` |
| `lint-ts1294-erasable` | TS1294: This syntax is not allowed when erasableSyntaxOnly is enabled (an enum, a namespace, a constructor parameter property) | erasableSyntaxOnly (needed for Node type stripping) forbids syntax that emits code | Use string-literal unions and 'as const' objects; plain constructor fields | verified |  | `typescript-and-lint-rules` |
| `lint-exact-optional` | exactOptionalPropertyTypes rejects an explicit undefined prop | Some third-party prop types do not include undefined | Conditional spread: {...(x ? { prop: value } : {})}; never relax the flag for the whole program | verified |  | `typescript-and-lint-rules` |
| `lint-expo-env-textstyle` | TS2353 or TS2559 on TextStyle after expo-env.d.ts entered a program | expo/types still clashes with React Native's Strict TypeScript API on SDK 57 | List expo-env.d.ts in the root tsconfig include and exclude (so expo start has nothing to add and it never enters a program); src/app-env.d.ts declares what is needed | verified (expo 57.x) |  | `typescript-and-lint-rules` |
| `lint-process-env-any` | @typescript-eslint/no-unsafe-argument on process.env['X'] in app.config.ts once an Expo module is imported anywhere in the program | expo-modules-core's globals turn process.env members into any in the root program | Pass the whole process.env to the variant resolver (resolveAppVariant(process.env)) instead of single members | verified |  | `app-variants-and-environment` |
| `lint-ts2769-navigate-never` | TS2769 No overload matches this call: Argument of type '"<route>"' is not assignable to parameter of type 'never' at navigation calls | The program never sees the global route-type augmentation (a .d.ts that nothing imports), so the route list is empty there | With Expo Router keep typed routes on and include the generated expo-env.d.ts types where the router reads them (or the router's typed hrefs); with React Navigation include the RootParamList declaration file in the tsconfig of every program that type-checks navigation | verified |  | `navigation-and-routing` |
| `lint-tsbuildinfo-node-modules` | A src/node_modules/ folder appears after npm run typecheck | tsBuildInfoFile: '${configDir}/node_modules/...' in a shared base resolves against the app program's folder | Point src/tsconfig.json's build info at the root cache folder | verified |  | `typescript-and-lint-rules` |
| `lint-rn-deep-imports` | react-native/Libraries/* imports become type errors after an upgrade | React Native's Strict TypeScript API (the default from RN 0.87) does not export deep paths | Never deep-import; opt into customConditions ['react-native-strict-api'] now | documented |  | `typescript-and-lint-rules` |
| `lint-paths-in-node` | A Node script cannot import '@/...' | Node type stripping ignores tsconfig paths | Node scripts import with relative paths and explicit .ts extensions (or a package self-reference in a multi-package repo) | verified |  | `architecture-and-boundaries` |
| `lint-tsconfig-baseurl` | A tsconfig copied from a guide sets baseUrl and paths that disagree with the template | Guides lag the template (extends expo/tsconfig.base, paths '@/*' to './src/*', no baseUrl) | Copy the canonical tsconfig set; aliases live only in the root tsconfig paths | documented |  | `typescript-and-lint-rules` |
| `lint-vendor-adapter-async` | A port adapter fails tsc when the vendor call is async | The result type was ReturnType<...>, which is a Promise for an async call | Use Awaited<ReturnType<...>> | verified |  | `architecture-and-boundaries` |

## ESLint config

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `lint-jest-rules-spread` | Assertion-free tests, duplicate titles and conditional expects pass lint | The test block spread jest flat/recommended and flat/style into one object, so the second rules key replaced the first | Use extends: [jest.configs['flat/recommended'], jest.configs['flat/style']]; the gate guardrail asserts jest/expect-expect is active | verified |  | `typescript-and-lint-rules` |
| `lint-await-fireevent` | `fireEvent.press` is sync and does not need `await` | testing-library's no-await-sync-events contradicts RNTL 14, where fireEvent returns a Promise | Turn testing-library/no-await-sync-events off; keep await-async-events and no-floating-promises | verified |  | `typescript-and-lint-rules` |
| `lint-left-right-data` | The physical-direction ban fires on { left, right } keys in pure data (a board, a geometry helper) | The selector matched any object key, but only styles are subject to RTL rules | Scope the selector to style contexts (StyleSheet.create, style props, *Style-typed variables) | verified |  | `typescript-and-lint-rules` |
| `lint-complexity-switch` | An exhaustive switch fails 'complexity of 12. Maximum allowed is 10' | ESLint 9 counts every case, ?., ??, default parameter and logical assignment | complexity: ['error', { max: 10, variant: 'modified' }] (a switch counts once); sonarjs cognitive complexity still bounds nesting | verified |  | `typescript-and-lint-rules` |
| `lint-determinism-leaks` | new Date() or performance.now() pass lint in pure logic | Only Date.now and Math.random were banned | Ban NewExpression[callee.name='Date'][arguments.length=0] and performance.now there too; time comes from the clock port | verified |  | `typescript-and-lint-rules` |
| `lint-remote-url-literals` | <Image source={{ uri: "https://..." }} /> passes lint in an app that routes network through a port | Only fetch was banned, but a remote image or a URL literal also makes a request | Ban http(s)://, ws(s):// literals outside the allowed link and API config files | verified |  | `networking-and-server-state` |
| `lint-warnings-pass` | exhaustive-deps, incompatible-library or unsupported-syntax only warn | eslint-plugin-react-hooks recommended marks them warn | Run eslint with --max-warnings 0 and raise them to error | verified |  | `typescript-and-lint-rules` |
| `lint-inline-disable-inert` | An // eslint-disable comment has no effect and is reported | linterOptions.noInlineConfig and reportUnusedDisableDirectives are on | Fix the code, or add a named file-level exemption in eslint.config.mjs with the reviewer's agreement and a Gate-Change trailer | verified |  | `quality-gates` |
| `lint-flat-config-replace` | A later config block silently drops restricted paths of an earlier block | In flat config a later block replaces (not merges) the options of the same rule | Repeat the shared paths (build the blocks from shared constants) | verified |  | `typescript-and-lint-rules` |
| `lint-import-order-type` | import/order wants a blank line between value and type imports of the same module | 'type' is its own group with newlines-between always | Put import type statements in a final group after a blank line | verified |  | `typescript-and-lint-rules` |
| `lint-unbound-method-tests` | @typescript-eslint/unbound-method flags expect(sdk.method) in tests | Library-typed methods look unbound | Type the mock locally (jest.mocked) or use jest/unbound-method in tests | verified |  | `unit-and-component-tests` |
| `lint-mock-naming` | naming-convention errors in a __mocks__ file | The mock mirrors the library's PascalCase exports | Turn naming-convention off for __mocks__/** | verified |  | `unit-and-component-tests` |
| `lint-no-dynamic-env-var` | expo/no-dynamic-env-var in app code | process.env['X'] or a computed name; Expo inlines only literal dot access | Use process.env.EXPO_PUBLIC_X literally in app code; read other variables in app.config.ts | verified |  | `app-variants-and-environment` |
| `lint-require-imports` | @typescript-eslint/no-require-imports on a require() in app code | Only the test-only gate may call require() (its literal comparison lets Metro drop the module) | Use imports; the one file-level exemption is src/test-only.ts | verified |  | `debug-menu-and-test-hooks` |
| `lint-max-lines-data` | max-lines fails on a data table, palette or catalog file | Large data tables were written as TypeScript | Move data to JSON (import with { type: "json" }); split code by responsibility, not by line count | verified |  | `typescript-and-lint-rules` |
| `lint-compiler-rules-upgrade` | New react-hooks errors appear after a dependency bump | React Compiler rules arrive with eslint-plugin-react-hooks minor versions | Run lint after every bump and fix the code; never turn the rule off | documented |  | `dependency-management` |
| `lint-exemption-file-renamed` | A clock adapter, direction module or text primitive suddenly fails lint | The ESLint exemptions name exact files; the file was renamed or moved | Keep the canonical file names; if a rename is right, change the exemption glob with a Gate-Change trailer | verified |  | `typescript-and-lint-rules` |
| `lint-guardrail-message-reworded` | The gate guardrail fails: a no-restricted-properties message differs from the recorded one | The guardrail compares the restricted-property messages word for word | Never reword them; copy eslint.config.mjs byte for byte from the canonical file | verified |  | `quality-gates` |
| `lint-prettier-filled-template` | prettier --check fails on a template right after its placeholders were filled | Filled values change line lengths, so the wrapping no longer matches Prettier | Run npx prettier --write on the filled files before lint and commit | verified |  | `typescript-and-lint-rules` |

## Naming

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `lint-boolean-constant-naming` | IS_DEBUG_BUILD rejected: must have one of the following prefixes | The boolean prefix rule allowed only camelCase prefixes | Allow UPPER_CASE with IS_/HAS_/CAN_/SHOULD_/DID_/WILL_/WAS_ prefixes | verified |  | `naming-conventions` |
| `lint-destructured-boolean` | const { granted } = ... or ({ disabled }: Props) rejected by naming-convention | Destructured booleans need the is/has prefix too | Rename while destructuring: { granted: isGranted } | verified |  | `naming-conventions` |
| `lint-pressed-callback` | ({ pressed }) in a style callback fails naming-convention | Boolean parameter naming applies to callback parameters | Rename: ({ pressed: isPressed }) | verified |  | `naming-conventions` |
| `lint-blocklist-invalid-pattern` | check-file/filename-blocklist crashes with "invalid pattern" | The suggestion was free text | Give the rule a glob suggestion such as '**/[a-z]*-[a-z]*.ts' | verified |  | `naming-conventions` |
| `lint-test-title-verb` | jest/valid-title: should match /^(can\|[a-z]+s)\b/u | Test titles start with a third-person verb or "can" | Write it('returns ...') or it('can ...'), not it('return ...') | verified |  | `unit-and-component-tests` |
| `lint-prefer-to-be` | jest/prefer-to-be: Use toBe when expecting primitive literals | toStrictEqual is rejected for numbers, strings and booleans | toBe for a primitive, toStrictEqual for an object or array | verified |  | `tdd-workflow` |

## Components

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `lint-makestyles-unused` | no-unused-styles reports every key as unused ("undefined.base") | makeStyles returned StyleSheet.create(...) directly | Use a block body: const styles = StyleSheet.create(...); return styles; | verified |  | `design-system-structure` |
| `lint-props-mutation` | props.items.push() is not flagged by the compiler rules | The React Compiler lint does not see array mutation through props | Type props readonly (readonly T[]) | verified |  | `react-components-and-hooks` |
| `lint-compiler-try-catch` | React Compiler skips a component or hook: "value blocks within a try/catch" | The compiler bails out on some try/catch shapes | Move the try/catch into a plain helper function the hook calls | verified |  | `react-components-and-hooks` |
| `lint-draw-many-params` | max-params fails on a draw or render helper with many inputs | The limit is three parameters | Pass one frame object ({ view, colors, layout, ... }) | verified |  | `typescript-and-lint-rules` |
