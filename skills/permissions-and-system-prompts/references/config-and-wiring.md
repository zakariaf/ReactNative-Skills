# Config, purpose strings and wiring

How a permission reaches the native build (Info.plist keys, Android manifest entries), how the
purpose strings stay translated, and how the PermissionsPort is wired into the app. Verified on
2026-10-14 against `@expo/config-plugins` and the SDK 57 plugins listed in `platform-behaviour.md`.

## Contents

1. Where each native entry comes from
2. What `false` does (and why it is dangerous for a permission you ask)
3. Android: blocked permissions
4. Purpose strings in every language
5. The production native snapshot
6. Wiring the port into the app
7. Classifying the SDK (architecture)
8. When multi-package

## 1. Where each native entry comes from

| Native entry | Written by | Read by the checker from |
|---|---|---|
| `NS*UsageDescription` in Info.plist | the module's config plugin option (`cameraPermission`, `photosPermission`, `locationWhenInUsePermission`, ...) or `ios.infoPlist` | `contracts/native-config.json` (`ios.infoPlist`), else `app.config.ts` text |
| translated purpose strings (`<lang>.lproj/InfoPlist.strings`) | app.config `locales`, built by `nativeLocales` from the catalogs | i18n-strings-and-catalogs' checkers |
| Android `<uses-permission>` | the library's own AndroidManifest (merged at build time) and the plugin (`withPermissions`) | not checked: library manifests merge after prebuild |
| Android removals (`tools:node="remove"`) | `android.blockedPermissions`, or a plugin that blocks (expo-image-picker with an option set to `false`) | the snapshot's `android.permissions`, else `blockedPermissions` and the expo-image-picker block in `app.config.ts` |

A plugin writes its default English text (`Allow $(PRODUCT_NAME) to access your camera`) for every
key it knows unless the option is given. Prebuild applies several plugins even when app.config does
not list them (expo-image-picker, expo-camera, expo-media-library, expo-location, expo-sensors,
expo-local-authentication, expo-contacts, expo-calendar): `expo-prebuild-and-config-plugins` requires
each to be listed, `i18n-strings-and-catalogs` fails a default English text.

## 2. What `false` does (and why it is dangerous for a permission you ask)

`@expo/config-plugins` `applyPermissions` (read in source):

```js
if (permissions[permission] === false) delete infoPlist[permission];
else infoPlist[permission] = permissions[permission] || infoPlist[permission] || description;
```

- A string option wins over `ios.infoPlist`; `ios.infoPlist` wins over the plugin default.
- `false` **deletes** the key, even one `ios.infoPlist` set. Use it for every permission the app never
  asks (it keeps vague English strings out of the build and out of App Review's questions).
  Caution: a binary that still links the API (PHPhotoLibrary inside ExpoImagePicker, for example) may
  draw ITMS-90683 "Missing purpose string" on an App Store Connect upload. If an upload reports it for
  a key you set to `false`, give that key a specific, translated sentence (`sourceText`) instead
  (**not verified** here until a TestFlight upload confirms it; `ios-release-testflight` owns uploads).
- `false` on a permission the app does ask is a crash on iOS at the request. And expo-image-picker
  57.0.20 also blocks the Android permission for `cameraPermission: false` and
  `microphonePermission: false` (`withBlockedPermissions`), so the same line breaks Android
  (`purpose-string` and `android-blocked` both fire). expo-camera 57.0.6 always adds `CAMERA`,
  whatever its options.

A shape to copy (an app that takes photos, never browses the library and never records):

```ts
[
  'expo-image-picker',
  {
    cameraPermission: sourceText(projectRoot, 'permissions.camera.usage-description'),
    photosPermission: false,     // the system photo picker needs no permission
    microphonePermission: false, // the app never records: also blocks RECORD_AUDIO
  },
],
```

## 3. Android: blocked permissions

`android.blockedPermissions` (app.config) removes a permission from the merged manifest, whatever
library declared it. Use it for permissions a library adds that the app never uses
(`expo-file-system`'s storage pair, `READ_MEDIA_*` when only the picker is used). Never block one the
app asks: the request then resolves `denied` without a dialog, forever, on every phone.
`android.permissions` adds a permission; prefer the module's plugin, which adds the right set.

The default for a new app (expo-project-bootstrap's skeleton leaves the decision here): block what
the prebuild template merges and a Tasks app never uses,

```ts
android: {
  blockedPermissions: [
    'android.permission.READ_EXTERNAL_STORAGE', // template, maxSdkVersion 32
    'android.permission.WRITE_EXTERNAL_STORAGE', // template, maxSdkVersion 32
    'android.permission.SYSTEM_ALERT_WINDOW', // the dev menu overlay: development builds only
  ],
},
```

Keep the storage pair (and declare it) only when the app reads or saves the shared media library on
Android 12L or lower through expo-media-library; keep `SYSTEM_ALERT_WINDOW` out of the blocked list
only in the development variant (app-variants-and-environment), where the dev client draws over
other apps. Every permission that stays in the merged manifest needs a store answer
(privacy-and-store-declarations).

## 4. Purpose strings in every language

The text lives in the catalogs, never in app.config (`i18n-strings-and-catalogs` owns the mechanics):

1. Add `permissions.<kind>.usage-description` to every catalog, plain text, no ICU arguments (iOS
   prints the braces; the alert already names the app).
2. Pass the base text to the plugin option with `sourceText(projectRoot, '<key>')`.
3. List the Info.plist key in `NATIVE_TEXT_KEYS.usageDescriptions` so `nativeLocales` writes it into
   every language's `InfoPlist.strings`.
4. Put the same key in the contract's `purposeKey`, so `copy-keys` proves it exists.

## 5. The production native snapshot

`expo-prebuild-and-config-plugins` keeps `contracts/native-config.json`, the native config that
`npx expo config --type introspect` derives for the production variant, regenerated on purpose and
reviewed like code. When it exists, `purpose-string` and `android-blocked` read it (exact: every
plugin has run), else they read `app.config.ts` as text (a heuristic: an option name with a value
that is not `false`, an `Info.plist` key outside `usageDescriptions`). After changing a plugin option,
regenerate the snapshot with that skill's `check-native-snapshot.mjs --write --variant production`
and review the diff: a new `NS*UsageDescription` or permission is the finding.

## 6. Wiring the port into the app

The templates add the port and its pieces; `architecture-and-boundaries` owns the composition root.
Add one member to `Services`, one line to each factory:

```ts
// src/services/services-context.tsx
import type { PermissionsPort } from '@/services/permissions/permissions-port';
export type Services = {
  // ...the existing ports
  readonly permissions: PermissionsPort;
};

// src/services/create-device-services.ts
const errorLog = createMemoryErrorLogAdapter({ clock });
return {
  // ...
  permissions: {
    access: { camera: createCameraPermissionAdapter({ errorLog }) },
    openSettings: createSystemSettingsAdapter({ errorLog }).openSettings,
  },
};

// src/services/create-test-services.ts
permissions: given.permissions ?? missingPort('permissions'),
```

A feature's model then reads `const { permissions, errorLog } = useServices();` and passes
`permissions.access.camera` and `permissions.openSettings` to `usePermissionGate` (the example model
takes them as a parameter only so it compiles without that change). Tests pass
`createFakePermissions({ camera: createFakePermissionAccess({ platform: 'ios' }) })` as
`services.permissions`.

With expo-camera's `CameraView` (not expo-image-picker), the camera adapter binds to
`Camera.getCameraPermissionsAsync` / `Camera.requestCameraPermissionsAsync` (`import { Camera } from
'expo-camera'`: exported in 57.0.6 but `@hidden` in the docs; re-verify on each SDK), never the
documented `useCameraPermissions` hook (rule 4). Add-only photo access (saving into the library) binds
`read: () => getPermissionsAsync(true)` and `request: () => requestPermissionsAsync(true)` from
expo-media-library: the `true` is what makes it the `photos-add` kind.

Add a kind: extend `PermissionKind`, write `<kind>-permission-adapter.ts` over the module's get and
request functions with `createExpoPermissionAccess`, add the contract entry, the catalog keys and the
plugin option, then wire it in the composition root.

## 7. Classifying the SDK (architecture)

`architecture-and-boundaries` fails any `expo-*` import that is neither a vendor SDK behind a port
nor a portless one (`unclassified-sdk`). A permission module is a vendor SDK: add it to
`contracts/architecture.json` `vendorSdks` with its port (for example
`"expo-image-picker": "PermissionsPort (camera) and the photo capture port"`) and to
`VENDOR_SDK_PATHS` in `eslint.config.mjs` in the same commit. `expo-permission-access.ts` imports only
`PermissionStatus` from `expo`, which needs no classification; adapters are the files ending in
`-adapter.ts` under `src/services/`, which is also what `request-boundary` accepts.

## 8. When multi-package

Run the checker once per app, with the app's folder as the root (it holds the app's `package.json`,
`app.config.ts`, `src/` and `contracts/`): `node check-permissions.mjs apps/mobile`. A different
layout passes `--src-dir`, `--contract` and `--native-config` (paths relative to that root). The
templates go under the app's `src/`; the core state module may live in a shared package as long as it
stays free of React Native and Expo imports.
