// src/api/build-url.test.ts
// Lint bans URL literals in tests too, so the base is a host-relative string: buildUrl never parses
// the scheme (src/config/api-base-url.ts validates it once at startup).
import { buildUrl, encodeQuery } from './build-url';

const BASE = 'api.tasks.test/v1';

describe('buildUrl', () => {
  it('keeps the base path in front of the request path', () => {
    expect(buildUrl(BASE, '/tasks')).toBe('api.tasks.test/v1/tasks');
  });

  it('treats a trailing slash on the base the same as none', () => {
    expect(buildUrl(`${BASE}/`, '/tasks')).toBe(buildUrl(BASE, '/tasks'));
  });

  it('appends the defined query parameters, encoded', () => {
    expect(
      buildUrl(BASE, '/tasks', { filter: 'open', q: 'milk & eggs', page: 2, done: false }),
    ).toBe('api.tasks.test/v1/tasks?filter=open&q=milk%20%26%20eggs&page=2&done=false');
  });

  it('adds no question mark when every parameter is undefined', () => {
    expect(buildUrl(BASE, '/tasks', { filter: undefined })).toBe('api.tasks.test/v1/tasks');
  });

  it('throws on a path without the leading slash', () => {
    expect(() => buildUrl(BASE, 'tasks')).toThrow('API paths start with "/"');
  });
});

describe('encodeQuery', () => {
  it('encodes names and values, Arabic text included', () => {
    expect(encodeQuery({ 'sort by': 'title', q: 'حليب' })).toBe(
      'sort%20by=title&q=%D8%AD%D9%84%D9%8A%D8%A8',
    );
  });
});
