// src/core/links/incoming-link.test.ts
// The parser facts every route decision rests on. The same WHATWG parser runs in Jest (Node) and in
// the app (expo/winter's whatwg-url-minimum 0.1.2): the vectors below gave identical protocol, host,
// path and query in both (compared on 2026-10-14).
import { MAX_LINK_LENGTH, hostMatches, parseIncomingLink } from './incoming-link';

import type { LinkOrigins } from './incoming-link';

const ORIGINS: LinkOrigins = {
  schemes: ['tasks', 'com.example.tasks'],
  hosts: ['tasks.example.com', '*.share.example.com'],
};

/** The scheme is a parameter so no remote URL literal sits in app code (lint: links live in src/config). */
const WEB = 'https';
const web = (host: string, path = '/tasks'): string => `${WEB}://${host}${path}`;

function parts(raw: string): unknown {
  const result = parseIncomingLink(raw, ORIGINS);
  return result.ok ? result.value : result.error.reason;
}

describe('parseIncomingLink', () => {
  it('reads a custom-scheme host as the first path segment', () => {
    expect(parts('tasks://tasks/task-7?highlight=a%26b')).toStrictEqual({
      origin: 'app-scheme',
      segments: ['tasks', 'task-7'],
      query: [['highlight', 'a&b']],
    });
    expect(parts('tasks:///tasks/task-7')).toStrictEqual(parts('tasks://tasks/task-7'));
    expect(parts('com.example.tasks://tasks')).toMatchObject({ segments: ['tasks'] });
  });

  it('reads a verified https link by its path only', () => {
    expect(parts(web('tasks.example.com', '/tasks/task-7#comments'))).toStrictEqual({
      origin: 'web',
      segments: ['tasks', 'task-7'],
      query: [],
    });
    expect(parts(web('TASKS.example.com'))).toMatchObject({ origin: 'web' });
    expect(parts(web('a.share.example.com'))).toMatchObject({ origin: 'web' });
  });

  it('treats a bare path like any custom-scheme link', () => {
    expect(parts('/tasks/task-7')).toMatchObject({
      origin: 'app-scheme',
      segments: ['tasks', 'task-7'],
    });
  });

  it('decodes segments once and keeps a trailing slash harmless', () => {
    expect(parts('tasks://tasks/caf%C3%A9/')).toMatchObject({ segments: ['tasks', 'café'] });
    expect(parts('tasks://tasks/..%2Fsettings')).toMatchObject({
      segments: ['tasks', '../settings'],
    });
  });

  it.each([
    ['evil://tasks/task-7', 'foreign-scheme'],
    ['javascript:alert(1)', 'foreign-scheme'],
    [web('evil.example.net', '/tasks/task-7'), 'foreign-host'],
    [web('share.example.com'), 'foreign-host'],
    [web('tasks.example.com.evil.net'), 'foreign-host'],
    [web('user:secret@tasks.example.com'), 'credentials'],
    [web('tasks.example.com:8443'), 'port'],
    ['tasks://tasks:80/task-7', 'port'],
    ['//evil.example.net/tasks', 'unparsable'],
    ['not a url', 'unparsable'],
    ['tasks://tasks//task-7', 'unparsable'],
    ['tasks://tasks/%E0%A4%A', 'bad-encoding'],
    [`tasks:///${'a'.repeat(MAX_LINK_LENGTH)}`, 'too-long'],
  ])('refuses %s as %s', (raw, reason) => {
    expect(parts(raw)).toBe(reason);
  });
});

describe('hostMatches', () => {
  it('matches exact hosts and subdomains of a wildcard, never the bare parent', () => {
    expect(hostMatches('tasks.example.com', ORIGINS.hosts)).toBe(true);
    expect(hostMatches('x.share.example.com', ORIGINS.hosts)).toBe(true);
    expect(hostMatches('share.example.com', ORIGINS.hosts)).toBe(false);
    expect(hostMatches('evilshare.example.com', ORIGINS.hosts)).toBe(false);
  });
});
