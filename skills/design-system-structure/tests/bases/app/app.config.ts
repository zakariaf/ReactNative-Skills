// app.config.ts (fixture excerpt): dark mode follows the phone, and the fonts are embedded.
import type { ExpoConfig } from 'expo/config';

const FONTS = './assets/fonts';

export default (): ExpoConfig => ({
  name: 'Tasks',
  slug: 'tasks',
  userInterfaceStyle: 'automatic',
  plugins: [
    'expo-router',
    [
      'expo-font',
      {
        fonts: [
          `${FONTS}/NotoSans-Regular.ttf`,
          `${FONTS}/NotoSans-Bold.ttf`,
          `${FONTS}/NotoSansArabic-Regular.ttf`,
          `${FONTS}/NotoSansArabic-Bold.ttf`,
        ],
      },
    ],
  ],
});
