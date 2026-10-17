// src/services/error-net/app-error-net.test.ts
import { appErrorNet } from './app-error-net';

import type { ErrorReport, GlobalErrorScope } from './error-net';

describe('appErrorNet', () => {
  it('chains the global handler of the running engine and restores it on uninstall', () => {
    const scope = globalThis as GlobalErrorScope;
    const before = scope.ErrorUtils?.getGlobalHandler();
    const sink: ErrorReport[] = [];
    appErrorNet.connect((report) => sink.push(report));

    const uninstall = appErrorNet.install();
    const installed = scope.ErrorUtils?.getGlobalHandler();
    appErrorNet.report({ source: 'render', error: new Error('render failed'), isFatal: false });
    uninstall();

    expect(installed).not.toBe(before);
    expect(scope.ErrorUtils?.getGlobalHandler()).toBe(before);
    expect(sink.map((report) => report.source)).toStrictEqual(['render']);
  });
});
