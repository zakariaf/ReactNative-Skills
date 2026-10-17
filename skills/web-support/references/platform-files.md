# Platform files

How Metro, TypeScript and Expo Router pick a file per platform, the one shape this skill allows, and
how a web file is held to the native file it replaces. Verified on 2026-10-14 by reading
`metro-resolver/src/resolve.js` and `@expo/metro-config` (SDK 57) and by the resolution errors a web
export prints. Re-verify: `grep -n "function resolveSourceFileForAllExts" -A16 node_modules/metro-resolver/src/resolve.js`.

## Contents

- 1. How Metro resolves `./x`
- 2. What TypeScript sees
- 3. Routes
- 4. The shape
- 5. The typed variant
- 6. Platform.OS instead of a file
- 7. Where variants live
- 8. Pitfalls

## 1. How Metro resolves `./x`

Expo's source extensions, in order: `ts, tsx, mjs, js, jsx, json, cjs` (then `scss, sass, css`).
For **each extension in that order**, Metro tries `x.<platform>.<ext>`, then (native platforms only)
`x.native.<ext>`, then `x.<ext>`, and stops at the first file that exists. The export's own error shows
the order: `wa-sqlite.wasm(.web.ts|.ts|.web.tsx|.tsx|.web.mjs|...)`.

So on the web:

| Files | `./x` resolves to |
|---|---|
| `x.ts`, `x.web.ts` | `x.web.ts` |
| `x.tsx`, `x.web.tsx` | `x.web.tsx` |
| `x.ts`, `x.web.tsx` | **`x.ts`**: `.ts` is tried for every platform before `.tsx`; the web file never loads |
| `x.tsx`, `x.web.ts` | `x.web.ts` (works, but only by luck of the order) |
| `x.native.ts` only | nothing: the web bundle fails to resolve `./x` |
| `x.web.ts` only | the web works; iOS and Android fail to resolve `./x` |

Metro on iOS and Android tries `.ios`/`.android` first, then `.native`, then the plain file, with the
same per-extension order. `web-platform-pair` fails the shadowed and the base-less cases.

## 2. What TypeScript sees

TypeScript has no platforms (the canonical tsconfig sets no `moduleSuffixes`): `import './x'` resolves
to `x.ts` or `x.tsx` only. So:

- Every importer is type-checked against the **base file**. The `.web.ts` file is checked on its own,
  never against what importers expect. A web file that forgets an export, or exports a function with a
  different signature, type-checks and fails in the browser.
- A variant without a base leaves `./x` unresolved for tsc (`TS2307`), even when every platform has
  a variant.
- The tsconfig `lib` includes `DOM` (Expo's base config), so `window.addEventListener` in a file iOS
  loads type-checks too. `web-browser-global` catches it.

## 3. Routes

Expo Router (3.5 and later) accepts a platform route file in `src/app` **only beside a route of the
same name without a platform** (`about.tsx` and `about.web.tsx`; `_layout.tsx` and `_layout.web.tsx`),
so every URL exists on every platform (Expo Router documentation, "Platform-specific extensions";
the failure mode of a lone `.web` route was not reproduced here). Prefer keeping the
route thin and putting the platform file in the feature: `src/app/about.tsx` re-exports the screen,
`src/features/about/about-screen.tsx` and `about-screen.web.tsx` differ.

## 4. The shape

One shape, everywhere:

```
x.ts            the base: the shared or native implementation, what TypeScript and every importer see
x.web.ts        the web implementation, same extension, same value exports, typed against x.ts
x.native.ts     optional: native-only code when the base is the web-safe shared version
```

- Same extension for every file of a group (`.ts` with `.ts`, `.tsx` with `.tsx`).
- The base exists. When the native code cannot load on the web (it imports a native-only package),
  the base is the native file and `x.web.ts` replaces it; or the base is the web-safe version and
  `x.native.ts` holds the native code. Both work; pick the one where the base is what most platforms run.
- Tests import a variant by its full name (`./x.web`), because the Jest projects resolve modules the way
  iOS does (testing-web.md).

## 5. The typed variant

A `.web` file holds itself to its base with a type-only import, so tsc compares them:

```ts
// src/services/share/react-native-share-adapter.web.ts
import type * as NativeShare from './react-native-share-adapter';

export const createReactNativeShareAdapter: typeof NativeShare.createReactNativeShareAdapter = () => ({
  shareTask: async (title, url) => {
    if (typeof navigator.share !== 'function') return 'unavailable';
    // ...
  },
});
```

- `import type` is erased, so Metro never sees `./react-native-share-adapter` from this file (on the
  web it would resolve to the file itself). TypeScript resolves it to the base and checks every
  export against `typeof NativeShare.<name>`.
- `web-variant-typed` requires the type import; `web-variant-exports` requires the same value export
  names in both files (a missing one is `undefined` for importers; an extra one is unreachable through
  `./x`).
- A constant the web file needs privately stays unexported (the warm-up adapter's lock name).

## 6. Platform.OS instead of a file

A short difference inside one function is clearer as a branch than as a second file:

```ts
if (Platform.OS === 'web') return; // react-native-web has no isBoldTextEnabled
void AccessibilityInfo.isBoldTextEnabled().then(setIsBold);
```

Expo inlines `Platform.OS` in production bundles and removes the dead branch (platform shaking), so a
branch costs nothing in size. `web-rn-api` accepts a call that a `Platform.OS` comparison keeps off the
web (`!== 'web'`, `=== 'ios'`, `=== 'ios' || === 'android'`, an early return on the web), a function
value under a `Platform.select` key the web never picks, or a `typeof` check (the shapes:
rn-api-gaps.md section 6). A plain value under `ios:` runs on the web too: the object is built before
`select` picks. A
branch never helps around a native-only *import*: an import is evaluated whatever the branch says, so
packages that fail on the web go behind a platform file (module-support.md).

Use a platform file when the implementations differ in more than a line, when one side imports a
package the other cannot load, or when the web side needs browser globals (`web-browser-global` allows
them only in `.web` files).

## 7. Where variants live

The architecture rules hold (architecture-and-boundaries): side effects sit behind a port in
`src/services/<concern>/`, and a platform difference lives in the adapter as
`<library>-<concern>-adapter.ts` plus `<library>-<concern>-adapter.web.ts`; the composition root imports
the base name and Metro picks the file. Features and screens import ports and stay one file. A web-only
capability becomes a port member (`isSupported`, an outcome such as `'unavailable'`), so the screen hides
a control instead of branching on the platform.

## 8. Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| The web build ignores `x.web.tsx` | base is `x.ts` (`.ts` is tried first) | same extension for both |
| `Unable to resolve module ./x` only on the web | `x.native.ts` with no base and no `.web` file | add the base or `x.web.ts` |
| `TS2307 Cannot find module './x'` while Metro works | variants without a base | add the base file |
| `undefined is not a function` in the browser, tsc green | the web file lacks an export the base has | the typed variant (section 5) |
| A `.web.tsx` route is unsupported | no route of the same name without a platform | add `about.tsx` |
| `window` code crashes iOS at runtime, tsc green | the `DOM` lib types it everywhere | move it into a `.web` file |
