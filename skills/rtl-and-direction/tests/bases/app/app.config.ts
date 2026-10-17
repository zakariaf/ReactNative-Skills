// app.config.ts (fixture excerpt): expo-localization gets the supported locales only.
const LOCALES = ['en', 'ar'];

export default {
  name: 'Tasks',
  plugins: [['expo-localization', { supportedLocales: { ios: LOCALES, android: LOCALES } }]],
};
