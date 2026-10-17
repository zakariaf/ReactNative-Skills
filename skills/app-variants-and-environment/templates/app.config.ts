// app.config.ts
// The only app config (no app.json): Expo reads its default export. APP_VARIANT picks the build:
// development (the dev client), preview (internal testing) or production (the stores). Each variant
// gets its own id, name, icon and URL scheme, so all three install side by side and a tester always
// knows which one is open. Everything else is the same for every variant. Node runs this file with
// type stripping: relative imports keep their .ts extension and only erasable syntax works. Secrets
// never flow into anything returned here: the whole public config (extra and plugin options
// included) is embedded in the app.
import { resolveAppVariant, variantIdentity } from './src/config/app-variant.ts';

import type { AppVariant, VariantIdentity } from './src/config/app-variant.ts';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/** The production identity: the store listing's id, name and URL scheme. */
const BASE: VariantIdentity = {
  appId: '__APP_ID__',
  name: '__APP_NAME__',
  scheme: '__APP_SCHEME__',
};

/**
 * The store icon on iOS, inside assets/icons/production/: the Icon Composer folder (iOS 26) when the
 * app has one, as the SDK 57 template does (expo.icon), else 'icon.png'.
 */
const STORE_IOS_ICON = 'expo.icon';

type VariantIcons = {
  /** 1024 x 1024 PNG: the fallback icon (Android's legacy icon reads it). */
  readonly fallback: string;
  readonly ios: string;
  readonly androidForeground: string;
  readonly androidBackground: string;
  readonly androidMonochrome: string;
};

/**
 * One icon folder per variant: assets/icons/<variant>/ holds icon.png, android-foreground.png,
 * android-background.png and android-monochrome.png (production also the .icon folder). Production
 * keeps the app's store icons; development and preview carry a visible badge, drawn by the
 * app-variants-and-environment skill's make-variant-icons script (icons-app-icon-and-splash may
 * redraw them at the same paths). Testing variants use their badged PNG on iOS too.
 */
function iconsFor(variant: AppVariant): VariantIcons {
  const folder = `./assets/icons/${variant}`;
  return {
    fallback: `${folder}/icon.png`,
    ios: variant === 'production' ? `${folder}/${STORE_IOS_ICON}` : `${folder}/icon.png`,
    androidForeground: `${folder}/android-foreground.png`,
    androidBackground: `${folder}/android-background.png`,
    androidMonochrome: `${folder}/android-monochrome.png`,
  };
}

function pluginsFor(variant: AppVariant): NonNullable<ExpoConfig['plugins']> {
  return [
    'expo-router',
    // The dev client registers an extra exp+<slug> scheme. Only the development build may: with
    // several variants installed, a QR code or link would otherwise open an undefined one on iOS
    // and a chooser on Android. The plugin needs the package: npx expo install expo-dev-client.
    ['expo-dev-client', { addGeneratedScheme: variant === 'development' }],
    // An app that adopts icons-app-icon-and-splash's drawn art replaces this entry with its
    // splashPlugin(projectRoot), and sets the production ios.icon to iosAppearanceIcon(projectRoot)
    // in place of STORE_IOS_ICON.
    [
      'expo-splash-screen',
      { backgroundColor: '#FFFFFF', image: './assets/images/splash-icon.png', imageWidth: 76 },
    ],
    // The app's other plugins, with their options, go here unchanged. Every installed package whose
    // plugin prebuild applies on its own is listed here too, with the options the app means
    // (expo-prebuild-and-config-plugins), and every package named here is a dependency.
  ];
}

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  const variant = resolveAppVariant(process.env);
  const identity = variantIdentity(BASE, variant);
  const icons = iconsFor(variant);
  return {
    ...config,
    // Merged from the old app config, the same for every variant: owner, version, ios.infoPlist
    // usage strings, android.permissions, and the EAS project link:
    //   owner: '<expo-account>',
    //   extra: { eas: { projectId: '<project-id>' } },
    name: identity.name,
    slug: '__APP_SLUG__',
    version: '1.0.0',
    orientation: 'portrait',
    icon: icons.fallback,
    scheme: identity.scheme,
    userInterfaceStyle: 'automatic',
    ios: { bundleIdentifier: identity.appId, icon: icons.ios, supportsTablet: true },
    android: {
      package: identity.appId,
      adaptiveIcon: {
        backgroundColor: '#FFFFFF',
        foregroundImage: icons.androidForeground,
        backgroundImage: icons.androidBackground,
        monochromeImage: icons.androidMonochrome,
      },
      predictiveBackGestureEnabled: true,
    },
    web: { output: 'static', favicon: './assets/images/favicon.png' },
    // Over-the-air updates stay off until ota-updates installs expo-updates; it then replaces this
    // line with ...updatesConfig(EAS_PROJECT_ID) (src/config/updates-config.ts: url, runtimeVersion
    // { policy: 'fingerprint' } and the launch settings together). Publish every update with the
    // build's variant: eas update --environment <variant> (app-variants-and-environment).
    updates: { enabled: false },
    plugins: pluginsFor(variant),
    experiments: { typedRoutes: true, reactCompiler: true },
  };
}
