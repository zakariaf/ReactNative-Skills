// app.config.ts: Expo reads the default export; Node runs it, so relative imports carry .ts.
import type { ConfigContext, ExpoConfig } from 'expo/config';

import withTaskWidget from './plugins/with-task-widget.ts';

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  return withTaskWidget({ ...config, name: 'Tasks', slug: 'tasks' });
}
