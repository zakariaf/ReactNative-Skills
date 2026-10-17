# Wiring the local lane (Tasks app)

The three edits an app makes beside the copied templates when it releases without EAS. The shape to
imitate; the app's own config keeps its other keys (app-variants-and-environment owns the variant
logic).

## app.config.ts

```ts
// app.config.ts (excerpt)
import { resolveAppVariant, variantIdentity } from './src/config/app-variant.ts';

import type { ConfigContext, ExpoConfig } from 'expo/config';

/** Android's own counter; npm run release:android bumps it before each store build. */
const ANDROID_VERSION_CODE = 14;

const BASE = { appId: 'com.acme.tasks', name: 'Tasks', scheme: 'tasks' };

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  const variant = resolveAppVariant(process.env);
  const identity = variantIdentity(BASE, variant);
  return {
    ...config,
    name: identity.name,
    slug: 'tasks',
    version: '1.4.0',
    ios: { bundleIdentifier: identity.appId },
    android: {
      package: identity.appId,
      versionCode: ANDROID_VERSION_CODE,
      // The template keeps the dev overlay's permission in the main manifest; the app never draws over others.
      blockedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW'],
    },
    plugins: [
      // Release builds sign with ~/.android-keys/com.acme.tasks-upload.jks when its properties exist.
      ['./plugins/with-upload-signing.ts', { applicationId: BASE.appId }],
      // ... every other plugin, in every variant
    ],
  };
}
```

- `ANDROID_VERSION_CODE` is a literal const that `release:android -- build` bumps and commits; never
  compute it from the environment or the date. It feeds `android.versionCode` only: the iOS local
  lane (ios-release-testflight) adds its own `const IOS_BUILD_NUMBER = <n>;` and `buildNumber` line,
  so each store counts its own builds and the tags stay in one scheme (`+android.<n>`, `+ios.<n>`).
- The plugin takes the production id, so the Gradle property names stay the same in every variant.

## package.json

```json
{
  "scripts": {
    "release:android": "node scripts/release-android/release-android.ts"
  }
}
```

## contracts/android-release.json

```json
{
  "$schema": "./android-release.schema.json",
  "lane": "local",
  "applicationId": "com.acme.tasks",
  "uploadCertificateSha256": "86:76:E3:D2:E7:A7:97:DB:29:8F:99:32:25:28:1D:C3:2D:D5:26:D4:D6:92:8E:EA:35:5F:6D:B1:F0:EF:3A:7C",
  "minTargetSdk": 36,
  "uploadTrack": "internal",
  "rollout": [0.05, 0.2, 0.5, 1],
  "permissions": {
    "android.permission.INTERNET": { "reason": "Requests through the ApiClient port, ads and purchases" },
    "android.permission.ACCESS_NETWORK_STATE": { "reason": "The Google Mobile Ads SDK checks connectivity before loading an ad" },
    "com.google.android.gms.permission.AD_ID": {
      "reason": "The Google Mobile Ads SDK reads the advertising ID for ads",
      "playDeclaration": "Advertising ID: yes, used for advertising or marketing"
    }
  }
}
```

The fingerprint above is a throwaway test certificate's; an app writes its own upload certificate's.
On the EAS lane the contract says `"lane": "eas"`, the app config keeps no `ANDROID_VERSION_CODE` and no
`versionCode` (EAS counts remotely) and lists no upload-signing plugin.
