// src/services/error-net/install-error-net.test.ts
import type { ErrorNet, GlobalErrorScope } from './error-net';

describe('install-error-net', () => {
  it('installs the error net once, as a side effect of the first import', () => {
    const scope = globalThis as GlobalErrorScope;
    const before = scope.ErrorUtils?.getGlobalHandler();

    jest.isolateModules(() => {
      require('./install-error-net');
      const installed = scope.ErrorUtils?.getGlobalHandler();
      require('./install-error-net');

      expect(installed).not.toBe(before);
      expect(scope.ErrorUtils?.getGlobalHandler()).toBe(installed);
      const { appErrorNet } = require('./app-error-net') as { appErrorNet: ErrorNet };
      appErrorNet.install()();
    });

    expect(scope.ErrorUtils?.getGlobalHandler()).toBe(before);
  });
});
