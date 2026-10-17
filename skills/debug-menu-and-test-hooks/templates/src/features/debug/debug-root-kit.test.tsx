// src/features/debug/debug-root-kit.test.tsx
// no-providers: the kit's motion slot is the provider under test (TestHooksRoot: the hooks' context
// and MotionConfig with the debug switch); it reads only the hooks it is given and the module-level
// system accessibility store.
import { act, render, screen } from '@testing-library/react-native';
import { use } from 'react';
import { View } from 'react-native';

import { createFakeClock } from '@/services/clock/fake-clock';
import { createTestServices } from '@/services/create-test-services';
import { createFakeDebugStorage } from '@/services/debug-storage/fake-debug-storage';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createTestHooks } from '@/services/test-hooks/create-test-hooks';
import { ReduceMotionPreferenceContext } from '@/ui/a11y/use-reduce-motion';

import { createDebugKit } from './debug-root-kit';
import { useTestHooks } from './test-hooks-context';

import type { TestHooks } from '@/services/test-hooks/create-test-hooks';

jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual<Record<string, unknown>>('react-native-reanimated'),
  // The real one warns once per mount in development builds; the mode itself is MotionConfig's test.
  ReducedMotionConfig: jest.fn(() => null),
}));

/** Names the preference the nearest MotionConfig provides and whether the hooks are reachable. */
function Probe({ hooks }: { readonly hooks: TestHooks }): React.JSX.Element {
  const provided = useTestHooks();
  const preference = use(ReduceMotionPreferenceContext);
  const reach = provided === hooks ? 'hooks' : 'other';
  return <View testID="debug.probe" accessibilityLabel={`${preference}:${reach}`} />;
}

function makeHooks(): TestHooks {
  return createTestHooks({
    services: createTestServices({
      clock: createFakeClock({ nowMs: 7, today: '2030-01-01' }),
      errorLog: createFakeErrorLog(),
    }),
    storage: createFakeDebugStorage(),
    settings: null,
  });
}

describe('createDebugKit', () => {
  it('opens the debug route group and fills the motion slot', () => {
    const kit = createDebugKit(makeHooks());
    expect(kit.name).toBe('debug');
    expect(kit.opensDebugRoutes).toBe(true);
    expect(kit.motion).toBeDefined();
    expect(kit.provide).toBeUndefined();
    expect(kit.effects).toBeUndefined();
  });

  it('provides the hooks and the app preference until motion is held still', async () => {
    const hooks = makeHooks();
    const motion = createDebugKit(hooks).motion;
    if (motion === undefined) throw new Error('the kit has no motion slot');
    await render(<>{motion({ preference: 'off', children: <Probe hooks={hooks} /> })}</>);
    expect(screen.getByTestId('debug.probe')).toHaveAccessibleName('off:hooks');

    await act(() => {
      hooks.overrides.getState().dispatch({ type: 'set-motion', motion: 'still' });
    });
    expect(screen.getByTestId('debug.probe')).toHaveAccessibleName('on:hooks');
    hooks.stop();
  });
});
