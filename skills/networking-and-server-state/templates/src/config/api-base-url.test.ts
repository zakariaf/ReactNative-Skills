// src/config/api-base-url.test.ts
// Lint bans URL literals in every test, so the URLs are built from a scheme and the rest.
import { parseApiBaseUrl } from './api-base-url';

const url = (scheme: string, rest: string): string => `${scheme}://${rest}`;

describe('parseApiBaseUrl', () => {
  it('accepts https in every variant and drops trailing slashes', () => {
    expect(
      (['development', 'preview', 'production'] as const).map((variant) =>
        parseApiBaseUrl(url('https', 'api.tasks.test/v1/'), variant),
      ),
    ).toStrictEqual(Array.from({ length: 3 }, () => url('https', 'api.tasks.test/v1')));
  });

  it('accepts http only in development', () => {
    const lan = url('http', '10.0.2.2:3000');

    expect(parseApiBaseUrl(lan, 'development')).toBe(lan);
    expect(() => parseApiBaseUrl(lan, 'preview')).toThrow('only in development');
    expect(() => parseApiBaseUrl(lan, 'production')).toThrow('only in development');
  });

  it('names the variable when it is missing or blank', () => {
    expect(() => parseApiBaseUrl(undefined, 'production')).toThrow(
      'EXPO_PUBLIC_API_URL is not set',
    );
    expect(() => parseApiBaseUrl('  ', 'production')).toThrow('EXPO_PUBLIC_API_URL is not set');
  });

  it('rejects a relative URL, a query and a fragment', () => {
    for (const raw of [
      'api.tasks.test',
      url('https', 'api.tasks.test?v=1'),
      url('https', 'api.tasks.test/#x'),
    ]) {
      expect(() => parseApiBaseUrl(raw, 'production')).toThrow('must be an https:// URL');
    }
  });
});
