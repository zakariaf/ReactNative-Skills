// app.config.ts
// The fixture app's config: the production icons and the splash come from the art pipeline
// (scripts/art/app-art-config.ts reads contracts/app-art.json and the palette).
import { iosAppearanceIcon, splashPlugin } from './scripts/art/app-art-config.ts';

import type { ConfigContext, ExpoConfig } from 'expo/config';

const ICONS = './assets/icons/production';

export default function appConfig({ config, projectRoot }: ConfigContext): ExpoConfig {
  return {
    ...config,
    name: 'Tasks',
    slug: 'tasks',
    icon: `${ICONS}/icon.png`,
    ios: { bundleIdentifier: 'com.example.tasks', icon: iosAppearanceIcon(projectRoot) },
    android: {
      package: 'com.example.tasks',
      adaptiveIcon: {
        foregroundImage: `${ICONS}/android-foreground.png`,
        backgroundImage: `${ICONS}/android-background.png`,
        monochromeImage: `${ICONS}/android-monochrome.png`,
      },
    },
    plugins: ['expo-router', splashPlugin(projectRoot)],
  };
}
