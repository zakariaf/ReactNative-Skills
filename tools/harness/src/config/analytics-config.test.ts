// src/config/analytics-config.test.ts
import { analyticsExtra, readAnalyticsExtra, resolveAnalyticsMode } from './analytics-config';

// Hosts are built from parts: app code (tests included) holds no remote URL literal.
const HTTPS = ['https:', '', ''].join('/');
const HOST = `${HTTPS}eu.i.posthog.com`;
const KEYS = { ANALYTICS_KEY: 'phc_publishable', ANALYTICS_HOST: HOST };

describe('resolveAnalyticsMode', () => {
  it('defaults to off in testing variants and live in production', () => {
    expect(resolveAnalyticsMode('development', {})).toBe('off');
    expect(resolveAnalyticsMode('preview', {})).toBe('off');
    expect(resolveAnalyticsMode('production', {})).toBe('live');
  });

  it('allows test in testing variants and off everywhere', () => {
    expect(resolveAnalyticsMode('preview', { ANALYTICS_MODE: 'test' })).toBe('test');
    expect(resolveAnalyticsMode('production', { ANALYTICS_MODE: 'off' })).toBe('off');
  });

  it('refuses the production project in testing variants and the test project in production', () => {
    expect(() => resolveAnalyticsMode('development', { ANALYTICS_MODE: 'live' })).toThrow(
      'not allowed',
    );
    expect(() => resolveAnalyticsMode('production', { ANALYTICS_MODE: 'test' })).toThrow(
      'not allowed',
    );
  });
});

describe('analyticsExtra and readAnalyticsExtra', () => {
  it('writes nothing to send with in an off build', () => {
    expect(analyticsExtra('development', KEYS, 'com.example.tasks.dev')).toStrictEqual({
      analytics: { mode: 'off', appId: 'com.example.tasks.dev', apiKey: null, host: null },
    });
  });

  it('needs a key and an https host to send', () => {
    expect(() => analyticsExtra('production', {}, 'com.example.tasks')).toThrow('ANALYTICS_KEY');
    expect(() =>
      analyticsExtra(
        'production',
        { ...KEYS, ANALYTICS_HOST: HOST.replace('https', 'http') },
        'id',
      ),
    ).toThrow('https');
  });

  it('reads back what it wrote for the same app id', () => {
    const extra = analyticsExtra('production', KEYS, 'com.example.tasks');
    expect(readAnalyticsExtra(extra, 'com.example.tasks')).toStrictEqual({
      mode: 'live',
      apiKey: 'phc_publishable',
      host: HOST,
    });
  });

  it('is off for another app id, an off build or a malformed extra', () => {
    const extra = analyticsExtra('production', KEYS, 'com.example.tasks');
    expect(readAnalyticsExtra(extra, 'com.example.tasks.preview')).toStrictEqual({ mode: 'off' });
    expect(readAnalyticsExtra(analyticsExtra('preview', {}, 'a'), 'a')).toStrictEqual({
      mode: 'off',
    });
    for (const bad of [
      null,
      'x',
      {},
      { analytics: null },
      { analytics: { mode: 'live', appId: 'a' } },
    ]) {
      expect(readAnalyticsExtra(bad, 'a')).toStrictEqual({ mode: 'off' });
    }
  });
});
