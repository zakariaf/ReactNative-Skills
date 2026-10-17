// index.ts
// Example: the app entry ("main": "index.ts") with the task registry. The Intl polyfills stay first
// (i18n-strings-and-catalogs), the registry comes next so every task is defined in a background launch
// that renders no route, and expo-router/entry stays last.
import '@/i18n/intl-polyfills';
import '@/services/background-tasks/define-background-tasks';

import 'expo-router/entry';
