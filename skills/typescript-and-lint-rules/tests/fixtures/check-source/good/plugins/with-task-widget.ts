// plugins/with-task-widget.ts: a config plugin Expo loads by path, so it default-exports.
import type { ExpoConfig } from 'expo/config';

/** Adds the widget entitlement marker; Node code may log. */
export default function withTaskWidget(config: ExpoConfig): ExpoConfig {
  console.log('with-task-widget applied');
  return { ...config, extra: { ...config.extra, hasTaskWidget: true } };
}
