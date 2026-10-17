// examples/app-config-plugin-list.ts: the shape of a Tasks app's plugin list (not copied; the app's
// app.config.ts, skeleton from expo-project-bootstrap and variant identities from
// app-variants-and-environment, is merged by hand).
// One list, one entry per plugin, a comment naming the skill that owns each line. Built-in keys
// first (ios.infoPlist, expo-build-properties); every installed package Expo would apply on its own
// is listed with the options the app means; local plugins by path.
import type { ExpoConfig } from 'expo/config';

type Variant = 'development' | 'preview' | 'production';

export function pluginsFor(variant: Variant): NonNullable<ExpoConfig['plugins']> {
  return [
    // navigation-and-routing: file routes.
    'expo-router',
    // app-variants-and-environment: only the development build registers the exp+<slug> scheme.
    ['expo-dev-client', { addGeneratedScheme: variant === 'development' }],
    // media-images-and-files: photos attach to a task; the app never records sound, so false also
    // blocks RECORD_AUDIO (prebuild would otherwise apply this plugin with English defaults).
    [
      'expo-image-picker',
      {
        photosPermission: 'Tasks attaches the photos you pick to a task.',
        cameraPermission: 'Tasks attaches the photos you take to a task.',
        microphonePermission: false,
      },
    ],
    // local-notifications: reminders. Listed so the push entitlement it adds is a decision.
    'expo-notifications',
    // expo-file-system arrives through expo and is not listed: listing would not remove the storage
    // permissions it adds; android.blockedPermissions (READ_/WRITE_EXTERNAL_STORAGE) in the config does.
    // expo-prebuild-and-config-plugins: Android queries for "Email this list" (iOS side:
    // ios.infoPlist.LSApplicationQueriesSchemes), no plugin of our own needed.
    [
      'expo-build-properties',
      {
        android: {
          manifestQueries: {
            intent: [{ action: 'android.intent.action.VIEW', data: { scheme: 'mailto' } }],
          },
        },
      },
    ],
    // expo-prebuild-and-config-plugins: the camera is optional, so Play keeps camera-less devices.
    [
      './plugins/with-android-optional-features.ts',
      { features: ['android.hardware.camera', 'android.hardware.camera.autofocus'] },
    ],
  ];
}
