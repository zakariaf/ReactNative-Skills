// app.config.ts
// The only app config. APP_VARIANT picks development, preview or production; every native change
// comes from the keys below and the plugin list.
import type { ConfigContext, ExpoConfig } from 'expo/config';

type Variant = 'development' | 'preview' | 'production';

function variantOf(env: Record<string, string | undefined>): Variant {
  const value = env['APP_VARIANT'] ?? 'development';
  if (value !== 'development' && value !== 'preview' && value !== 'production') {
    throw new Error(`unknown APP_VARIANT "${value}"`);
  }
  return value;
}

function plugins(): NonNullable<ExpoConfig['plugins']> {
  return [
    'expo-router',
    [
      'expo-image-picker',
      {
        photosPermission: 'Tasks attaches the photos you pick to a task.',
        cameraPermission: 'Tasks attaches the photos you take to a task.',
        microphonePermission: false,
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          manifestQueries: { intent: [{ action: 'android.intent.action.VIEW', data: { scheme: 'mailto' } }] },
        },
      },
    ],
    [
      './plugins/with-android-optional-features.ts',
      { features: ['android.hardware.camera', 'android.hardware.camera.autofocus'] },
    ],
  ];
}

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  const variant = variantOf(process.env);
  const suffix = variant === 'production' ? '' : variant === 'development' ? '.dev' : '.preview';
  return {
    ...config,
    name: variant === 'production' ? 'Tasks' : `Tasks (${variant})`,
    slug: 'tasks',
    version: '1.0.0',
    scheme: `tasks${suffix.replace('.', '-')}`,
    ios: {
      bundleIdentifier: `com.example.tasks${suffix}`,
      infoPlist: { LSApplicationQueriesSchemes: ['mailto'] },
    },
    android: { package: `com.example.tasks${suffix}` },
    plugins: plugins(),
    extra: { eas: { projectId: '00000000-0000-4000-8000-000000000000' } },
  };
}
