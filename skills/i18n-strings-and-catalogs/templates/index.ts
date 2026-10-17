// index.ts
// The app entry ("main": "index.ts" in package.json). Modules that must run before any route
// module come first: the forced Intl polyfills, because Hermes has no Intl.PluralRules or
// Intl.Locale. expo-router/entry comes last and registers the app.
import '@/i18n/intl-polyfills';

import 'expo-router/entry';
