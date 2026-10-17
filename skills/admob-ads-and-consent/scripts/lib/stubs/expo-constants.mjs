// Stand-in for 'expo-constants' when check-ad-behaviour.mjs runs read-ads-extra.ts under Node.
// The checker sets constantsStub.extra to what app.config.ts would have written, or constantsStub.config
// to a whole running config (an embedded config or an EAS Update's manifest). Not an entry point.

export const constantsStub = { extra: undefined, config: undefined };

const Constants = {
  get expoConfig() {
    return constantsStub.config ?? { extra: constantsStub.extra };
  },
};

export default Constants;
