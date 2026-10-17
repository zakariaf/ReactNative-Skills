// src/services/crash-reporter/crash-forwarder.test.ts
import { createCrashForwarder, FORWARDED_SOURCES } from './crash-forwarder';
import { createFakeCrashReporter } from './fake-crash-reporter';

function setup(): {
  readonly forward: ReturnType<typeof createCrashForwarder>;
  readonly crashReporter: ReturnType<typeof createFakeCrashReporter>;
} {
  const crashReporter = createFakeCrashReporter();
  crashReporter.setConsent(true);
  return { forward: createCrashForwarder(crashReporter), crashReporter };
}

describe('createCrashForwarder', () => {
  it('forwards render errors and unhandled rejections, the two Sentry cannot see', () => {
    const { forward, crashReporter } = setup();
    const renderError = new Error('render');
    const rejection = new Error('rejected');
    forward({ source: 'render', error: renderError, isFatal: false });
    forward({ source: 'unhandled-rejection', error: rejection, isFatal: false });
    expect(crashReporter.sent).toStrictEqual([
      { error: renderError, context: { source: 'render', isFatal: false } },
      { error: rejection, context: { source: 'unhandled-rejection', isFatal: false } },
    ]);
  });

  it('forwards no global-handler report (Sentry captures those itself, once)', () => {
    const { forward, crashReporter } = setup();
    forward({ source: 'global-handler', error: new Error('uncaught'), isFatal: true });
    expect(crashReporter.sent).toStrictEqual([]);
    expect(FORWARDED_SOURCES).not.toContain('global-handler');
  });
});
