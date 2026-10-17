// app.config.ts
import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Tasks',
  slug: 'tasks',
  scheme: 'tasks',
  experiments: { typedRoutes: true, reactCompiler: true },
};

export default config;
