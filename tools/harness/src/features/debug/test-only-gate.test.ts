// src/features/debug/test-only-gate.test.ts
// The gate reads the variant when it loads (Jest does not inline EXPO_PUBLIC_* values, so each case
// loads a fresh copy with the variable set). The bundle proof that Metro drops the entry from a
// production export is app-variants-and-environment's check-variant-bundle.
import type * as TestOnlyModule from '@/test-only';

function loadGate(variant: string): typeof TestOnlyModule {
  Object.assign(process.env, { EXPO_PUBLIC_APP_VARIANT: variant });
  const loaded: (typeof TestOnlyModule)[] = [];
  jest.isolateModules(() => {
    loaded.push(require('@/test-only') as typeof TestOnlyModule);
  });
  const [gate] = loaded;
  if (gate === undefined) throw new Error('the gate did not load');
  return gate;
}

describe('the test-only gate', () => {
  const variant = process.env.EXPO_PUBLIC_APP_VARIANT;

  afterEach(() => {
    if (variant === undefined) Reflect.deleteProperty(process.env, 'EXPO_PUBLIC_APP_VARIANT');
    else Object.assign(process.env, { EXPO_PUBLIC_APP_VARIANT: variant });
  });

  it.each(['development', 'preview'])('loads the entry in a %s build', (name) => {
    expect(loadGate(name).TEST_ONLY?.TEST_BUILD_SENTINEL).toMatch(
      /^[A-Z][A-Z0-9_]*_TEST_BUILD_ONLY$/u,
    );
  });

  it('is null in a production build', () => {
    expect(loadGate('production').TEST_ONLY).toBeNull();
  });

  it('offers what the registry and the debug routes call', () => {
    const kit = loadGate('preview').TEST_ONLY;

    expect(Object.keys(kit ?? {}).sort()).toStrictEqual([
      'DebugMenuRoot',
      'DebugSetupRoot',
      'ParityLaunchScreen',
      'TEST_BUILD_SENTINEL',
      'createDebugKit',
      'createKvDebugStorageAdapter',
      'createParityKit',
      'createTestHooks',
      'installNetworkGuard',
    ]);
  });
});
