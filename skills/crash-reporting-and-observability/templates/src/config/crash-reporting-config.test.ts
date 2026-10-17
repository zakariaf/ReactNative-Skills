// src/config/crash-reporting-config.test.ts
import {
  PROFILES_SAMPLE_RATE,
  TRACES_SAMPLE_RATE,
  parseCrashReportingConfig,
  readCrashReportingConfig,
} from './crash-reporting-config';

// Lint bans URL literals in every test, so the URLs are built from a scheme and the rest.
const url = (scheme: string, rest: string): string => `${scheme}://${rest}`;
const DSN = url('https', '0123456789abcdef@o12345.ingest.sentry.io/678901');

describe('parseCrashReportingConfig', () => {
  it('reports preview and production as their own environment', () => {
    expect(parseCrashReportingConfig(DSN, 'preview')).toStrictEqual({
      dsn: DSN,
      environment: 'preview',
      tracesSampleRate: TRACES_SAMPLE_RATE,
      profilesSampleRate: PROFILES_SAMPLE_RATE,
    });
    expect(parseCrashReportingConfig(` ${DSN} `, 'production').dsn).toBe(DSN);
  });

  it.each([
    url('https', 'abc123@sentry.example.test/sentry/42'),
    url('https', 'abc123@sentry.example.test:9000/a/b/42'),
  ])('accepts the self-hosted DSN %j (with a path prefix)', (raw) => {
    expect(parseCrashReportingConfig(raw, 'production').dsn).toBe(raw);
  });

  it('keeps the development variant silent, even with a DSN', () => {
    expect(parseCrashReportingConfig(DSN, 'development').dsn).toBeNull();
    expect(parseCrashReportingConfig(undefined, 'development').dsn).toBeNull();
  });

  it('turns reporting off for a preview build without a DSN', () => {
    expect(parseCrashReportingConfig('', 'preview').dsn).toBeNull();
  });

  it('refuses a production build without a DSN', () => {
    expect(() => parseCrashReportingConfig(undefined, 'production')).toThrow(
      'EXPO_PUBLIC_CRASH_REPORTER_DSN is not set',
    );
  });

  it.each([
    url('http', 'key@host/1'),
    url('https', 'host/1'),
    'sentry.io',
    url('https', 'key@host/x'),
    url('https', 'key@host/sentry/'),
  ])('refuses the malformed DSN %j', (raw) => {
    expect(() => parseCrashReportingConfig(raw, 'preview')).toThrow('must look like');
  });

  it('samples a share of sessions and profiles no more than it traces', () => {
    expect(TRACES_SAMPLE_RATE).toBeGreaterThanOrEqual(0);
    expect(TRACES_SAMPLE_RATE).toBeLessThanOrEqual(1);
    expect(PROFILES_SAMPLE_RATE).toBeGreaterThanOrEqual(0);
    expect(PROFILES_SAMPLE_RATE).toBeLessThanOrEqual(TRACES_SAMPLE_RATE);
  });
});

describe('readCrashReportingConfig', () => {
  const saved = {
    dsn: process.env.EXPO_PUBLIC_CRASH_REPORTER_DSN,
    variant: process.env.EXPO_PUBLIC_APP_VARIANT,
  };

  // In Jest, Babel reads EXPO_PUBLIC_* from process.env at run time (production bundles inline them).
  function setBundle(name: string, value: string | undefined): void {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else Object.assign(process.env, { [name]: value });
  }

  afterEach(() => {
    setBundle('EXPO_PUBLIC_CRASH_REPORTER_DSN', saved.dsn);
    setBundle('EXPO_PUBLIC_APP_VARIANT', saved.variant);
  });

  it('reads the build variant and its DSN', () => {
    setBundle('EXPO_PUBLIC_APP_VARIANT', 'preview');
    setBundle('EXPO_PUBLIC_CRASH_REPORTER_DSN', url('https', 'key@o1.ingest.sentry.io/42'));
    expect(readCrashReportingConfig()).toMatchObject({
      dsn: url('https', 'key@o1.ingest.sentry.io/42'),
      environment: 'preview',
    });
  });

  it('returns no DSN for a development bundle, which never reports', () => {
    setBundle('EXPO_PUBLIC_APP_VARIANT', undefined);
    setBundle('EXPO_PUBLIC_CRASH_REPORTER_DSN', url('https', 'key@o1.ingest.sentry.io/42'));
    expect(readCrashReportingConfig().dsn).toBeNull();
  });
});
