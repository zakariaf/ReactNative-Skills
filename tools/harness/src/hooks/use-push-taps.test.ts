// src/hooks/use-push-taps.test.ts
// no-providers: usePushTaps takes the port and the navigate function as arguments.
import { act, renderHook } from '@testing-library/react-native';

import { createFakePush } from '@/services/push/fake-push';

import { usePushTaps } from './use-push-taps';

import type { PushDestination } from '@/core/push/push-destination';

const LIST_TAP = { id: 'n1', action: 'open', data: { kind: 'list-shared', listId: 'l1' } };

describe('usePushTaps', () => {
  it('opens the launch tap after mounting, then later taps, with the latest navigate', async () => {
    const push = createFakePush({ lastResponse: LIST_TAP });
    const first: PushDestination[] = [];
    const second: PushDestination[] = [];
    const { rerender, unmount } = await renderHook(
      ({ navigate }: { navigate: (destination: PushDestination) => void }) => {
        usePushTaps({ push, navigate });
      },
      { initialProps: { navigate: (destination: PushDestination) => first.push(destination) } },
    );
    await rerender({ navigate: (destination: PushDestination) => second.push(destination) });
    await act(() => {
      push.tap({ id: 'n2', action: 'open', data: { kind: 'announcement' } });
    });
    await unmount();
    push.tap({ id: 'n3', action: 'open', data: { kind: 'announcement' } });

    expect(first).toStrictEqual([{ screen: 'list', listId: 'l1' }]);
    expect(second).toStrictEqual([{ screen: 'inbox' }]);
  });
});
