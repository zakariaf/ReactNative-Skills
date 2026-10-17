// src/services/share/react-native-share-adapter.web.ts
import type * as NativeShare from './react-native-share-adapter';

export const createReactNativeShareAdapter: typeof NativeShare.createReactNativeShareAdapter = () => ({
  shareTask: async (title, url) => {
    if (typeof navigator.share !== 'function') return 'unavailable';
    try {
      await navigator.share({ title, url });
      return 'shared';
    } catch {
      return 'dismissed';
    }
  },
});
