// app.config.ts
// The fixture app config: one identity and scheme per variant, and the verified links of the
// variant built from contracts/deep-links.json (scripts/deep-links/link-native-config.ts).
import { linkNativeConfig, readLinkContract } from './scripts/deep-links/link-native-config.ts';

type Variant = 'development' | 'preview' | 'production';

const SUFFIX: Record<Variant, string> = { development: '.dev', preview: '.preview', production: '' };
const SCHEME: Record<Variant, string> = { development: 'acme-tasks-dev', preview: 'acme-tasks-preview', production: 'acme-tasks' };

export default function appConfig({ projectRoot }: { projectRoot: string }): Record<string, unknown> {
  const variant = (process.env.APP_VARIANT ?? 'development') as Variant;
  const links = linkNativeConfig(readLinkContract(projectRoot), variant);
  return {
    name: 'Tasks',
    slug: 'tasks',
    scheme: SCHEME[variant],
    ios: { bundleIdentifier: `com.acme.tasks${SUFFIX[variant]}`, ...(links.associatedDomains && { associatedDomains: links.associatedDomains }) },
    android: { package: `com.acme.tasks${SUFFIX[variant]}`, intentFilters: links.intentFilters },
  };
}
