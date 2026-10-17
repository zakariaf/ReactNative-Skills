# Red boxes, the dev server and the default stack at run time

Failures while the app runs in development and in production: Metro and the dev server, React red boxes and warnings, Expo Router navigation, network requests, TanStack Query, over-the-air updates, crash reports, secure storage and deep links, on both platforms. Match the text you see in the Symptom column, or run `find-fix.mjs --text "<first error line>"`.

Status: **verified** = seen and fixed in a real run; **documented** = read in the tool's own source or docs; **open** = not settled, the fix is the current fallback. **needs a human** = a stop: send one message and wait, never work around it. Platform: blank = both. Skill = where the full procedure lives. Reviewed on 2026-10-17 against Expo SDK 57 (expo 57.0.27), React Native 0.86.3, React 19.2.3, Xcode 26.6, Android compileSdk and targetSdk 36, Jest 29.7, Maestro 2.10; re-verify the versions with `npx expo start --help && npm ls react react-native expo-router @tanstack/react-query`.

<!-- Generated from assets/known-failures/runtime.json by scripts/check-catalogue.mjs --write. Edit the JSON, not this file. -->

## Contents

- Dev server
- Metro
- Rendering
- Lists
- Hooks
- JavaScript
- Native modules
- Expo Router
- Networking
- TanStack Query
- Over-the-air updates
- Crash reporting
- Secure storage
- Deep links

## Dev server

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `runtime-no-bundle-url` | No bundle URL present. Make sure you're running a packager server or have included a .jsbundle file in your application bundle. | A Debug build of the iOS app started while Metro was not running (or Metro runs on another port than the build expects); a Release build has the bundle embedded and never shows it | Start Metro for this project (npx expo start, or the port the dev client was built for) and reload the app; never switch the build to Release to hide it. For a release check, build the Release configuration on purpose | documented | iOS | `ios-simulator-build` |
| `runtime-dev-server-unreachable` | Could not connect to development server (the red box when the app cannot fetch its bundle) | Metro is not running, or the device cannot reach it: on the Android emulator localhost is the emulator itself, and a physical device on another network cannot reach the computer | Start Metro; on the Android emulator forward the port to that one device (adb -s <serial> reverse tcp:8081 tcp:8081) or use 10.0.2.2; put a physical device on the same network. Never adb kill-server (it drops every session's devices); the Android "Unable to load script" red box is e2e-android-adb-reverse | documented |  | `android-emulator-build` |
| `runtime-metro-port-in-use` | Port 8081 is being used by another process (npx expo start asks to use another port) | Another Metro, often another project's or another session's, already listens on the port | Leave the other process alone (it may be another session's); start this project on its own port (npx expo start --port 8082) and point the dev client at it, or stop only a Metro you started | documented |  | `expo-project-bootstrap` |
| `runtime-metro-emfile` | Error: EMFILE: too many open files, watch (Metro stops while starting or after a few reloads) | Metro's file watcher hit the macOS open-file limit; without Watchman it opens one handle per watched file | Install Watchman (Metro uses it when it is on the PATH) or raise the limit for that shell (ulimit -n 65536); keep watchFolders narrow. Never delete node_modules to make it go away | documented |  | `expo-project-bootstrap` |

## Metro

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `runtime-unable-to-resolve-module` | Unable to resolve module <path> from <file>: None of these files exist | The import path is wrong (a typo, or a case difference that macOS tolerates and Linux CI does not), the package is not installed, or the @/ alias is not declared in tsconfig.json paths | Fix the import to the exact file name and case, install a missing package with npx expo install, and use the @/ alias the canonical tsconfig declares; tsc --noEmit finds the same import first | documented |  | `architecture-and-boundaries` |

## Rendering

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `runtime-text-outside-text` | Text strings must be rendered within a <Text> component. | A raw string or number is a child of a View: usually {count && <Badge />} with count 0 or an empty string, a stray character or space between JSX tags, or a translated string placed directly in a View | Wrap text in <Text> (the design-system Text component); write conditions as count > 0 ? <Badge /> : null so a falsy number is never rendered | documented |  | `react-components-and-hooks` |
| `runtime-element-type-invalid` | Element type is invalid: expected a string (for built-in components) or a class/function (for composite components) but got: undefined | An import resolves to undefined: a default import of a named export (or the reverse), a circular import that is still undefined at render, or a component the installed library version no longer exports | Open the file named in "Check the render method of <Component>" and fix the import to the module's real export (house style: named exports); break the cycle by moving the shared piece into its own module | documented |  | `react-components-and-hooks` |

## Lists

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `runtime-nested-virtualized-list` | VirtualizedLists should never be nested inside plain ScrollViews with the same orientation because it can break windowing and other functionality | A FlatList, SectionList or FlashList sits inside a ScrollView that scrolls the same way, so the list renders every row and loses recycling | Make the list the only scroller: move the content above and below into ListHeaderComponent and ListFooterComponent, or use one SectionList; never silence the warning with LogBox | documented |  | `react-components-and-hooks` |
| `runtime-missing-list-key` | Each child in a list should have a unique "key" prop. | A .map() returns elements without a key, or the keys repeat; a FlatList has no keyExtractor and its items have no key or id | Key each element by a stable id from the data (never the index for a list that reorders); give FlatList and FlashList a keyExtractor | documented |  | `react-components-and-hooks` |

## Hooks

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `runtime-invalid-hook-call` | Invalid hook call. Hooks can only be called inside of the body of a function component | A hook is called outside a component or custom hook (an event handler, a plain helper, a class), or the bundle holds two copies of React (a package that brings its own react, or two versions in a workspace) | Call hooks only at the top level of components and use* hooks (react-hooks/rules-of-hooks catches it); npm ls react must show one version, otherwise dedupe or pin it | documented |  | `react-components-and-hooks` |
| `runtime-hook-order-changed` | Rendered more hooks than during the previous render, or Rendered fewer hooks than expected | A hook runs after an early return or inside a condition or loop, so the number of hooks differs between renders | Move every hook above the first early return and out of conditions; let react-hooks/rules-of-hooks run as an error | documented |  | `react-components-and-hooks` |

## JavaScript

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `runtime-undefined-property` | TypeError: Cannot read property '<name>' of undefined (Hermes), or undefined is not an object (evaluating '<expr>') | Code reads a field of a value that is undefined at run time: data used before it loaded, a field missing from stored or server data, or an import that resolved to undefined | Read the first frame in your own code in the stack; validate data where it enters (the schema at the boundary) and model the loading state in the type instead of asserting it; keep noUncheckedIndexedAccess on | documented |  | `error-handling-typed-results` |
| `runtime-crypto-missing` | ReferenceError: Property 'crypto' doesn't exist (a uuid or id library calls crypto.getRandomValues or crypto.randomUUID) | Hermes has no Web Crypto global, so code written for browsers or Node finds no crypto object | Generate ids and random bytes through expo-crypto (randomUUID, getRandomValues) behind your own port; for a library that needs the global, load a crypto polyfill at the entry before that library is imported | documented |  | `seeded-determinism-and-golden-vectors` |

## Native modules

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `runtime-native-module-not-linked` | requireNativeComponent: '<Name>' was not found in the UIManager, or The package '<name>' doesn't seem to be linked | JavaScript and the installed native binary disagree: a package with native code was added or upgraded after the dev build was made, or the app runs in Expo Go, which holds only Expo's own modules | Rebuild the development build after any native dependency change (npx expo run:ios or run:android, or a new development build) and install versions with npx expo install; reloading JavaScript cannot add native code | documented |  | `native-modules-and-new-architecture` |

## Expo Router

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `runtime-navigate-before-mount` | Attempted to navigate before mounting the Root Layout component. Ensure the Root Layout component is rendering a Slot, or other navigator on the first render. | The root layout returns null or a loading view instead of its navigator while it loads, or an effect calls router.replace before the navigator has mounted | Always render the navigator from the root layout and keep the splash screen up while loading; send the user with <Redirect> in a screen or with Stack.Protected guards, never with router calls in the root layout's first effects | documented |  | `navigation-and-routing` |
| `runtime-route-not-handled` | The action 'NAVIGATE' with payload {"name":"<route>"} was not handled by any navigator, or No route named "<route>" exists in nested children | The href does not match a route file: a typo, a route group or folder left out of the path, a file outside the app folder, or a screen of a navigator that is not mounted | Navigate by the route's real path and turn on typed routes so tsc checks every href; list the screen in its layout when the layout names its screens | documented |  | `navigation-and-routing` |
| `runtime-navigation-context-missing` | Couldn't find a navigation context. Have you wrapped your app with 'NavigationContainer'? | A navigation hook runs outside the router tree (a component rendered above the root navigator or in a test render without the router), or a second copy of @react-navigation/native is installed | Use expo-router's hooks inside routes, test screens with expo-router's renderRouter, and keep one @react-navigation/native version (npm ls @react-navigation/native) | documented |  | `navigation-and-routing` |

## Networking

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `runtime-network-request-failed` | TypeError: Network request failed | The request never reached a server: Android blocks plain http:// by default, iOS App Transport Security blocks it too, localhost on the Android emulator is the emulator itself, the TLS certificate is self-signed, or the device is offline | Use https everywhere; reach a local server through the variant's API URL (adb -s <serial> reverse, or the computer's address) and allow cleartext only in the development variant through a config plugin; let the ApiClient map this error to its typed network failure so the screen shows the offline state | documented |  | `networking-and-server-state` |

## TanStack Query

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `runtime-query-not-refetching-on-focus` | Data stays stale after the app returns to the foreground or the network comes back, although refetchOnWindowFocus and refetchOnReconnect are on | React Native has no window focus or online events, so TanStack Query never learns that the app became active or that the network returned | Wire focusManager to AppState and onlineManager to the connectivity port once at startup (the networking skill's template) | documented |  | `networking-and-server-state` |
| `runtime-query-key-unstable` | A query refetches on every render or its cache never hits; two screens show different data for the same item | The query key holds a new object or function each render, or leaves out a value the queryFn reads, so the cache entry changes or is shared wrongly | Build keys from a key factory of plain values only, and put every variable the queryFn uses into its key | documented |  | `networking-and-server-state` |

## Over-the-air updates

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `runtime-update-not-applied` | An update was published but the installed app keeps running the bundle it was built with | The update went to a branch the build's channel does not point to, its runtime version differs from the build's (a native change moved the fingerprint), or it downloaded in the background and applies only at the next cold start | Compare the build's channel and runtime version with the update's; republish to the right branch or ship a new store build when the runtime changed; kill and relaunch the app to load a downloaded update | documented |  | `ota-updates` |

## Crash reporting

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `runtime-crash-stack-minified` | Crash reports show minified frames (index.android.bundle or main.jsbundle line 1 with a large column) instead of source files | The source maps and debug IDs of that build or update were never uploaded: the auth token was missing from the build environment, Metro does not use the crash reporter's serializer, or an over-the-air update was published without its own upload | Give the build environment the upload token as a secret, use the crash reporter's Metro config so bundles carry debug IDs, and upload source maps for every update you publish; confirm the release shows its artifacts before the next crash | documented |  | `crash-reporting-and-observability` |

## Secure storage

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `runtime-secure-store-survives-reinstall` | After deleting and reinstalling the app on iOS, the user is still signed in or an old token is sent | iOS keeps keychain items when an app is deleted, so expo-secure-store values outlive the install while app storage starts empty | On first launch, when app storage holds no install marker, delete the secure-store keys and then write the marker | documented | iOS | `auth-and-secure-storage` |

## Deep links

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `runtime-universal-link-opens-browser` | An https link to your domain opens Safari instead of the app | iOS could not verify the domain: apple-app-site-association is not served at /.well-known/ over https without redirects, its appID (team ID plus bundle id) does not match the build, or associatedDomains lacks applinks:<domain> | Serve the association file unredirected with the matching appID and path rules, add applinks:<domain> to the variant's associated domains, then reinstall the app (iOS fetches the file at install) | documented | iOS | `deep-links-and-universal-links` |
| `runtime-app-link-not-verified` | An https link to your domain shows a chooser or opens the browser instead of the app on Android | Android did not verify the App Link: assetlinks.json is not served at /.well-known/, or its SHA-256 fingerprints lack the key that signs the installed build (the Play app-signing key for store installs) | List every signing key's SHA-256 in assetlinks.json, keep autoVerify on the intent filter, reinstall, and read the state with adb -s <serial> shell pm get-app-links <package> | documented | Android | `deep-links-and-universal-links` |
