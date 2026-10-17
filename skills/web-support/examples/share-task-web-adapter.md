# Example: a share adapter with a web variant (shape only)

A Tasks app shares a task link. iOS and Android use React Native's `Share`; the web uses the Web Share
API and falls back to the clipboard. The port, the screen and the composition root stay one file each;
only the adapter has a `.web.ts` sibling, held to the native file by a type-only import.

## The port

```ts
// src/services/share/share-port.ts
export type ShareOutcome = 'shared' | 'copied' | 'dismissed' | 'unavailable';

export type SharePort = {
  readonly shareTask: (title: string, url: string) => Promise<ShareOutcome>;
};
```

## The native adapter (the base file)

```ts
// src/services/share/react-native-share-adapter.ts
import { Share } from 'react-native';

import type { SharePort } from './share-port';

export function createReactNativeShareAdapter(): SharePort {
  return {
    shareTask: async (title, url) => {
      const result = await Share.share({ title, message: `${title} ${url}`, url });
      return result.action === Share.sharedAction ? 'shared' : 'dismissed';
    },
  };
}
```

## The web adapter (same extension, same exports, typed against the base)

```ts
// src/services/share/react-native-share-adapter.web.ts
// The Web Share API needs a press, a secure context and a browser that has it; the clipboard is the
// fallback. Browser globals appear only inside the function, so static rendering never reads them.
import type * as NativeShare from './react-native-share-adapter';

export const createReactNativeShareAdapter: typeof NativeShare.createReactNativeShareAdapter = () => ({
  shareTask: async (title, url) => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
        return 'shared';
      } catch {
        return 'dismissed';
      }
    }
    if (navigator.clipboard === undefined) return 'unavailable';
    try {
      await navigator.clipboard.writeText(url);
      return 'copied';
    } catch {
      return 'unavailable';
    }
  },
});
```

## The fake and the composition root

```ts
// src/services/share/fake-share.ts
import type { ShareOutcome, SharePort } from './share-port';

export function createFakeShare(outcome: ShareOutcome = 'shared'): SharePort & { readonly shared: string[] } {
  const shared: string[] = [];
  return {
    shared,
    shareTask: (_title, url) => {
      shared.push(url);
      return Promise.resolve(outcome);
    },
  };
}

// src/services/create-device-services.ts (excerpt): the base name; Metro picks the .web file on the web
import { createReactNativeShareAdapter } from '@/services/share/react-native-share-adapter';
```

## The web adapter's test (unit project, explicit import)

```ts
// src/services/share/react-native-share-adapter-web.test.ts
import { createReactNativeShareAdapter } from './react-native-share-adapter.web';

const originalShare = Object.getOwnPropertyDescriptor(navigator, 'share');
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function useNavigator(fields: Partial<Pick<Navigator, 'share' | 'clipboard'>>): void {
  for (const [key, value] of Object.entries(fields)) {
    Object.defineProperty(navigator, key, { value, configurable: true });
  }
}

describe('createReactNativeShareAdapter (web)', () => {
  afterEach(() => {
    for (const [key, original] of [['share', originalShare], ['clipboard', originalClipboard]] as const) {
      if (original) Object.defineProperty(navigator, key, original);
      else Reflect.deleteProperty(navigator, key);
    }
  });

  it('shares through the Web Share API when the browser has it', async () => {
    const share = jest.fn(() => Promise.resolve());
    useNavigator({ share });

    await expect(createReactNativeShareAdapter().shareTask('Buy milk', 'https://example.app/t/1')).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'Buy milk', url: 'https://example.app/t/1' });
  });

  it('copies the link when there is no Web Share API', async () => {
    const writeText = jest.fn(() => Promise.resolve());
    useNavigator({ share: undefined, clipboard: { writeText } as unknown as Clipboard });

    await expect(createReactNativeShareAdapter().shareTask('Buy milk', 'https://example.app/t/1')).resolves.toBe('copied');
  });
});
```

## What the checker sees

- `web-platform-pair`: base `react-native-share-adapter.ts` and `react-native-share-adapter.web.ts`
  share the `.ts` extension.
- `web-variant-exports`: both export `createReactNativeShareAdapter` and nothing else.
- `web-variant-typed`: `import type * as NativeShare from './react-native-share-adapter'`.
- `web-browser-global`: `navigator` appears only in the `.web.ts` file.
- `web-ssr-scope`: `navigator` is read inside the function, never at module scope.
- The screen shows "Link copied" for `'copied'` and hides the share button for `'unavailable'`
  (ui-states-and-feedback owns the toast).
