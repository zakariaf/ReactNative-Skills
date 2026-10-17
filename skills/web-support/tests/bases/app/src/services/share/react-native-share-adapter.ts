// src/services/share/react-native-share-adapter.ts
import { Share } from 'react-native';

import type { SharePort } from './share-port';

export function createReactNativeShareAdapter(): SharePort {
  return {
    shareTask: async (title, url) => {
      const result = await Share.share({ title, message: `${title} ${url}` });
      return result.action === Share.sharedAction ? 'shared' : 'dismissed';
    },
  };
}
