// plugins/with-app-name.ts
import { withInfoPlist } from 'expo/config-plugins.js';

import type { ConfigPlugin } from 'expo/config-plugins.js';

const withAppName: ConfigPlugin<{ readonly name: string }> = (config, { name }) =>
  withInfoPlist(config, (next) => ({ ...next, modResults: { ...next.modResults, CFBundleDisplayName: name } }));

export default withAppName;
