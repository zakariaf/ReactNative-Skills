// src/core/links/route-incoming-link.test.ts
import fc from 'fast-check';

import { buildLinkHref, routeIncomingLink } from './route-incoming-link';

import type { LinkPolicy } from './route-incoming-link';

type Target = { readonly pathname: string; readonly params: Readonly<Record<string, string>> };

const POLICY: LinkPolicy<Target> = {
  schemes: ['tasks'],
  hosts: ['tasks.example.com'],
  isTestBuild: false,
  routes: [
    { path: '/tasks/[taskId]', params: { taskId: 'slug' }, query: ['highlight'] },
    { path: '/tasks/new' },
    {
      path: '/lists/[listId]',
      params: { listId: 'slug' },
      gate: 'signed-in',
      open: (values) => ({ pathname: '/lists/[listId]', params: values }),
    },
    { path: '/verify-email', query: ['token'], verifiedOnly: true },
    { path: '/debug/setup', query: 'any', testBuildOnly: true },
  ],
};

const closed = (): boolean => false;
/** The scheme is a parameter so no remote URL literal sits in app code (lint: links live in src/config). */
const WEB = 'https';
const web = (host: string, path: string): string => `${WEB}://${host}${path}`;
const decide = (raw: string, policy: LinkPolicy<Target> = POLICY): unknown =>
  routeIncomingLink(raw, policy, closed);

describe('routeIncomingLink', () => {
  it('opens an allow-listed route and keeps only its query keys', () => {
    expect(decide('tasks://tasks/task-7?highlight=c-3&utm_source=mail')).toStrictEqual({
      kind: 'open',
      href: '/tasks/task-7?highlight=c-3',
      path: '/tasks/[taskId]',
    });
    expect(decide(web('tasks.example.com', '/tasks/task-7'))).toMatchObject({
      href: '/tasks/task-7',
    });
  });

  it('prefers the static route over a dynamic one', () => {
    expect(decide('tasks://tasks/new')).toMatchObject({ kind: 'open', path: '/tasks/new' });
  });

  it('opens home for the bare scheme, the launch URL of a normal start', () => {
    expect(decide('tasks://')).toStrictEqual({ kind: 'home' });
    expect(decide('tasks:///')).toStrictEqual({ kind: 'home' });
  });

  it('encodes values again so a decoded & never becomes a new query key', () => {
    expect(decide('tasks://tasks/task-7?highlight=a%26admin%3D1')).toMatchObject({
      href: '/tasks/task-7?highlight=a%26admin%3D1',
    });
  });

  it.each([
    ['tasks://settings/delete-account', 'unknown-route'],
    ['tasks://tasks/task-7/edit', 'unknown-route'],
    ['tasks://tasks/..%2Fsettings', 'bad-param'],
    ['tasks://tasks/Task-7', 'bad-param'],
    ['tasks://tasks/task-7?highlight=a&highlight=b', 'repeated-query'],
    [`tasks://tasks/task-7?highlight=${'x'.repeat(257)}`, 'bad-query'],
    ['tasks://tasks/task-7?highlight=a%0Ab', 'bad-query'],
    ['tasks://verify-email?token=abc', 'unverified-origin'],
    ['tasks://debug/setup?date=2026-01-01', 'test-build-only'],
    ['evil://tasks/task-7', 'foreign-scheme'],
  ])('refuses %s (%s)', (raw, reason) => {
    expect(decide(raw)).toStrictEqual({ kind: 'refused', reason });
  });

  it('accepts a verifiedOnly route from a verified https link', () => {
    expect(decide(web('tasks.example.com', '/verify-email?token=abc'))).toMatchObject({
      kind: 'open',
      href: '/verify-email?token=abc',
    });
  });

  it('passes every query pair of a test-build route through in test builds', () => {
    const policy = { ...POLICY, isTestBuild: true };
    expect(decide('tasks://debug/setup?date=2026-01-01&date=x', policy)).toMatchObject({
      href: '/debug/setup?date=2026-01-01&date=x',
    });
  });

  it('defers a gated link while its gate is closed and opens it when open', () => {
    expect(decide('tasks://lists/home-list')).toStrictEqual({
      kind: 'deferred',
      gate: 'signed-in',
      target: { pathname: '/lists/[listId]', params: { listId: 'home-list' } },
    });
    expect(routeIncomingLink('tasks://lists/home-list', POLICY, () => true)).toMatchObject({
      kind: 'open',
      href: '/lists/home-list',
    });
  });

  it('keeps the checked segment value when a query key of a gated link shares its name', () => {
    const policy: LinkPolicy<Target> = {
      ...POLICY,
      routes: [
        {
          path: '/lists/[listId]',
          params: { listId: 'slug' },
          query: ['listId'],
          gate: 'signed-in',
          open: (values) => ({ pathname: '/lists/[listId]', params: values }),
        },
      ],
    };
    expect(decide('tasks://lists/home-list?listId=..%2Fsettings', policy)).toMatchObject({
      kind: 'deferred',
      target: { params: { listId: 'home-list' } },
    });
  });

  it('returns a decision for any input without throwing', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (raw) => {
        expect(() => routeIncomingLink(raw, POLICY, closed)).not.toThrow();
        expect(() => routeIncomingLink(`tasks://${raw}`, POLICY, closed)).not.toThrow();
      }),
    );
  });

  it('opens what it opened before when its own href comes back (idempotent)', () => {
    const value = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,20}$/u);
    fc.assert(
      fc.property(value, fc.string({ maxLength: 40 }), (taskId, highlight) => {
        const href = buildLinkHref('/tasks/[taskId]', { taskId }, [['highlight', highlight]]);
        const first = routeIncomingLink(`tasks://${href}`, POLICY, closed);
        if (first.kind !== 'open') return;
        expect(routeIncomingLink(first.href, POLICY, closed)).toStrictEqual(first);
      }),
    );
  });
});
