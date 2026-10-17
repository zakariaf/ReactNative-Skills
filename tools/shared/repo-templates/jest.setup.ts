// jest.setup.ts — runs after the test framework is installed, in the 'unit' and 'android' projects,
// and in 'golden' while the app has no Skia (never in the CanvasKit golden project, whose pixels must
// be real).
// Versions verified: react-native-gesture-handler 2.32, react-native-worklets 0.10.1, react-native-reanimated 4.5.1,
// @shopify/react-native-skia 2.6.2. An app without one of the first three deletes its line.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import 'react-native-gesture-handler/jestSetup';

jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
require('react-native-reanimated').setUpTests();

// A jest.mock factory for a package that is not installed fails this file and every suite with it,
// so a mock of an optional package waits for the package (or, for an app module, for its file).
const hasPackage = (name: string): boolean =>
  existsSync(join(__dirname, 'node_modules', name, 'package.json'));

// Skia's native module does not load under jest-expo ("Native Skia Module failed to correctly
// install JSI Bindings"), so every suite that imports a component drawing with Skia would crash, and
// so would every screen that shows one. Here each Skia component (Canvas, Group, Path, Picture, ...)
// renders as an inert host element named Skia<Component> that keeps its props (testID,
// accessibility), each Skia.* or helper call returns an inert object, and the loading hooks
// (useFont, useImage) return null. Pixels are proven in the 'golden' project, which draws with the
// real CanvasKit. A test that inspects Skia calls mocks the package itself; its jest.mock replaces
// this one there.
if (hasPackage('@shopify/react-native-skia')) {
  jest.mock('@shopify/react-native-skia', () => {
    const inert = (): unknown =>
      new Proxy(() => undefined, {
        get: (_target, key) => {
          if (key === Symbol.toPrimitive) return () => '';
          if (key === 'then') return undefined;
          return inert();
        },
        apply: () => inert(),
      });
    const module: Record<string, unknown> = { __esModule: true, Skia: inert() };
    return new Proxy(module, {
      get: (target, key) => {
        if (typeof key !== 'string' || key === 'default' || key === 'then') return undefined;
        if (Object.hasOwn(target, key)) return target[key];
        if (/^use[A-Z]/.test(key)) return () => null;
        if (/^[A-Z]/.test(key)) return `Skia${key}`;
        return inert();
      },
    });
  });
}
