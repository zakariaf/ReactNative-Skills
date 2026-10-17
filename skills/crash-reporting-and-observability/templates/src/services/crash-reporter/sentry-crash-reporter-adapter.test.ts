// src/services/crash-reporter/sentry-crash-reporter-adapter.test.ts
import { REDACTED } from './crash-scrubber';
import { FAKE_PENDING_LIMIT } from './fake-crash-reporter';
import {
  MAX_BREADCRUMBS,
  PENDING_LIMIT,
  createSentryCrashReporterAdapter,
  sentryOptions,
} from './sentry-crash-reporter-adapter';

import type { CrashReportingConfig } from '@/config/crash-reporting-config';

jest.mock('@sentry/react-native');

/** The SDK functions the adapter calls, as the root mock __mocks__/@sentry/react-native.ts provides them. */
type SentryMock = {
  readonly init: jest.Mock<unknown, unknown[]>;
  readonly captureException: jest.Mock<unknown, unknown[]>;
  readonly addBreadcrumb: jest.Mock<unknown, unknown[]>;
  readonly close: jest.Mock<Promise<boolean>, []>;
  readonly flush: jest.Mock<Promise<boolean>, []>;
  readonly reactNativeErrorHandlersIntegration: jest.Mock<unknown, unknown[]>;
};

const sentry = jest.requireMock<SentryMock>('@sentry/react-native');

// Lint bans URL literals in every test, so the URLs are built from a scheme and the rest.
const url = (scheme: string, rest: string): string => `${scheme}://${rest}`;
const DSN = url('https', '0123456789abcdef@o12345.ingest.sentry.io/678901');
const CONFIG: CrashReportingConfig = {
  dsn: DSN,
  environment: 'preview',
  tracesSampleRate: 0,
  profilesSampleRate: 0,
};
const RENDER = { source: 'render', isFatal: false } as const;

function setup(config: CrashReportingConfig = CONFIG): {
  readonly reporter: ReturnType<typeof createSentryCrashReporterAdapter>;
  readonly errors: unknown[];
} {
  const errors: unknown[] = [];
  const reporter = createSentryCrashReporterAdapter(config, (error) => {
    errors.push(error);
  });
  return { reporter, errors };
}

describe('createSentryCrashReporterAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts nothing when created and waits for the choice', () => {
    const { reporter } = setup();
    reporter.captureException(new Error('early'), RENDER);
    reporter.addBreadcrumb({ category: 'navigation', message: '(app)/index' });
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(reporter.status()).toBe('waiting');
  });

  it('starts once on consent and sends what waited, in order', () => {
    const { reporter } = setup();
    reporter.addBreadcrumb({ category: 'navigation', message: '(app)/index', data: { tab: 1 } });
    reporter.captureException(new Error('early'), { source: 'unhandled-rejection', isFatal: true });
    reporter.setConsent(true);
    reporter.setConsent(true);

    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(reporter.status()).toBe('reporting');
    expect(sentry.addBreadcrumb).toHaveBeenCalledWith({
      category: 'app.navigation',
      message: '(app)/index',
      level: 'info',
      data: { tab: 1 },
    });
    expect(sentry.captureException).toHaveBeenCalledWith(new Error('early'), {
      level: 'fatal',
      tags: { source: 'unhandled-rejection' },
    });
  });

  it('keeps only the newest PENDING_LIMIT items while waiting', () => {
    const { reporter } = setup();
    for (let index = 0; index < PENDING_LIMIT + 5; index += 1) {
      reporter.captureException(new Error(`e${String(index)}`), RENDER);
    }
    reporter.setConsent(true);
    expect(sentry.captureException).toHaveBeenCalledTimes(PENDING_LIMIT);
    expect(sentry.captureException.mock.calls[0]?.[0]).toStrictEqual(new Error('e5'));
    // The fake used by app tests queues exactly as much.
    expect(FAKE_PENDING_LIMIT).toBe(PENDING_LIMIT);
  });

  it('drops what waited on a refusal and never starts', async () => {
    const { reporter } = setup();
    reporter.captureException(new Error('early'), RENDER);
    reporter.setConsent(false);
    reporter.captureException(new Error('late'), RENDER);
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(reporter.status()).toBe('off');
    await expect(reporter.flush()).resolves.toBe(false);
  });

  it('starts after a first refusal is changed to consent', () => {
    const { reporter } = setup();
    reporter.setConsent(false);
    reporter.setConsent(true);
    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(reporter.status()).toBe('reporting');
  });

  it('closes the SDK when reporting is turned off and keeps it closed for the run', () => {
    const { reporter } = setup();
    reporter.setConsent(true);
    reporter.setConsent(false);
    expect(sentry.close).toHaveBeenCalledTimes(1);
    reporter.captureException(new Error('while off'), RENDER);
    reporter.setConsent(true);
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(reporter.status()).toBe('off');
  });

  it('keeps a build without a DSN off', () => {
    const { reporter } = setup({ ...CONFIG, dsn: null });
    reporter.setConsent(true);
    reporter.captureException(new Error('boom'), RENDER);
    expect(sentry.init).not.toHaveBeenCalled();
    expect(reporter.status()).toBe('off');
  });

  it('records an SDK failure instead of throwing', () => {
    const failure = new Error('native module missing');
    sentry.init.mockImplementationOnce(() => {
      throw failure;
    });
    const { reporter, errors } = setup();
    expect(() => {
      reporter.setConsent(true);
    }).not.toThrow();
    expect(errors).toStrictEqual([failure]);
    expect(reporter.status()).toBe('off');
  });

  it('flushes through the SDK only while reporting', async () => {
    const { reporter } = setup();
    reporter.setConsent(true);
    await expect(reporter.flush()).resolves.toBe(true);
    expect(sentry.flush).toHaveBeenCalledTimes(1);
  });
});

describe('sentryOptions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds the privacy-first option set with the variant as environment', () => {
    const options = sentryOptions(DSN, CONFIG);
    expect(options).toMatchObject({
      dsn: DSN,
      environment: 'preview',
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableCaptureFailedRequests: false,
      maxBreadcrumbs: MAX_BREADCRUMBS,
    });
    expect(options).not.toHaveProperty('release');
    expect(options).not.toHaveProperty('dist');
    expect(options).not.toHaveProperty('tracesSampleRate');
    expect(sentry.reactNativeErrorHandlersIntegration).toHaveBeenCalledWith({
      onunhandledrejection: false,
    });
  });

  it('traces only when the config samples, and profiles no more than it traces', () => {
    const options = sentryOptions(DSN, { ...CONFIG, tracesSampleRate: 0.1, profilesSampleRate: 1 });
    expect(options.tracesSampleRate).toBe(0.1);
    expect(options.profilesSampleRate).toBe(0.1);
  });

  it('scrubs every event and breadcrumb on the way out', () => {
    const options = sentryOptions(DSN, CONFIG);
    const event = options.beforeSend?.(
      { type: undefined, message: 'failed for ana@tasks.test', user: { email: 'ana@tasks.test' } },
      {},
    );
    expect(event).toMatchObject({ message: `failed for ${REDACTED}` });
    expect(event).toHaveProperty('user', undefined);
    expect(options.beforeBreadcrumb?.({ category: 'console', message: 'x' })).toBeNull();
  });
});
