// src/hooks/use-screen-views.test.tsx
// no-providers: the hook reads only expo-router's segments (mocked here) and the injected callback.
import { renderHook } from '@testing-library/react-native';
import { useSegments } from 'expo-router';

import { useScreenViews } from './use-screen-views';

jest.mock('expo-router', () => ({ useSegments: jest.fn() }));

const segmentsMock = jest.mocked(useSegments);

describe('useScreenViews', () => {
  it('reports the route pattern once per screen, never the concrete path', async () => {
    segmentsMock.mockReturnValue(['(app)', 'tasks', '[id]'] as never);
    const onScreen = jest.fn();
    const { rerender } = await renderHook(() => {
      useScreenViews(onScreen);
    });
    await rerender({});
    expect(onScreen.mock.calls).toStrictEqual([['tasks/[id]']]);

    segmentsMock.mockReturnValue(['(app)', 'settings'] as never);
    await rerender({});
    expect(onScreen.mock.calls).toStrictEqual([['tasks/[id]'], ['settings']]);
  });
});
