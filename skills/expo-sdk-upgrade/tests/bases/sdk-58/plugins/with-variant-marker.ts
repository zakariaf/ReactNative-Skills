// plugins/with-variant-marker.ts
import { withInfoPlist } from 'expo/config-plugins';

import type { ConfigPlugin } from 'expo/config-plugins';

type Options = { readonly variant: string };

const withVariantMarker: ConfigPlugin<Options> = (config, { variant }) =>
  withInfoPlist(config, (next) => ({ ...next, modResults: { ...next.modResults, TasksVariant: variant } }));

export default withVariantMarker;
