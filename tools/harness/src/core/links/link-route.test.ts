// src/core/links/link-route.test.ts
import { PARAM_KINDS, dynamicName, linkRouteProblems, pathSegments } from './link-route';

import type { LinkRouteSpec } from './link-route';

const open = (): string => '/tasks';

describe('PARAM_KINDS', () => {
  it.each([
    ['slug', 'task-12', true],
    ['slug', 'Task-12', false],
    ['slug', '-task', false],
    ['slug', 'a'.repeat(64), true],
    ['slug', 'a'.repeat(65), false],
    ['slug', '../settings', false],
    ['uuid', '1b4e28ba-2fa1-41d2-883f-0016d3cca427', true],
    ['uuid', '1B4E28BA-2FA1-41D2-883F-0016D3CCA427', false],
    ['int', '0', true],
    ['int', '007', false],
    ['int', '123456789', true],
    ['int', '1234567890', false],
  ] as const)('accepts for kind %s the value %j: %s', (kind, value, isAccepted) => {
    expect(PARAM_KINDS[kind].test(value)).toBe(isAccepted);
  });
});

describe('pathSegments and dynamicName', () => {
  it('splits a path and names its dynamic segments', () => {
    expect(pathSegments('/tasks/[taskId]/edit')).toStrictEqual(['tasks', '[taskId]', 'edit']);
    expect(pathSegments('/')).toStrictEqual([]);
    expect(dynamicName('[taskId]')).toBe('taskId');
    expect(dynamicName('tasks')).toBeNull();
    expect(dynamicName('[...rest]')).toBeNull();
  });
});

describe('linkRouteProblems', () => {
  it('accepts a sound table', () => {
    const routes: readonly LinkRouteSpec[] = [
      { path: '/tasks/[taskId]', params: { taskId: 'slug' }, query: ['highlight'] },
      { path: '/lists/[listId]', params: { listId: 'uuid' }, gate: 'signed-in', open },
      { path: '/debug/setup', query: 'any', testBuildOnly: true },
    ];
    expect(linkRouteProblems(routes)).toStrictEqual([]);
  });

  it('names every problem with its path', () => {
    const routes: readonly LinkRouteSpec[] = [
      { path: 'tasks/[taskId]', params: { taskId: 'slug', extra: 'int' } },
      { path: '/(app)/settings' },
      { path: '/notes/[noteId]' },
      { path: '/search', query: 'any' },
      { path: '/search', query: ['q x'] },
      { path: '/inbox', gate: 'signed-in' },
      { path: '/notes/[noteId]/edit', params: { noteId: 'slug' }, query: ['noteId'] },
    ];
    expect(linkRouteProblems(routes)).toStrictEqual([
      'tasks/[taskId]: path must start with /',
      'tasks/[taskId]: params.extra is not a segment of the path',
      '/(app)/settings: segment "(app)" is not a URL segment',
      '/notes/[noteId]: [noteId] has no kind in params',
      "/search: query 'any' is for test-build routes only",
      '/search: listed twice',
      '/search: query key "q x" is not a plain name',
      '/inbox: gate "signed-in" needs open() to reopen the link after the gate opens',
      '/notes/[noteId]/edit: query key "noteId" shadows a path param',
    ]);
  });
});
