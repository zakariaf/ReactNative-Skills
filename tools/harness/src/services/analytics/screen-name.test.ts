// src/services/analytics/screen-name.test.ts
import { isRoutePattern } from './analytics-sanitize';
import { screenNameFromSegments } from './screen-name';

describe('screenNameFromSegments', () => {
  it('drops layout groups and keeps dynamic segments as patterns', () => {
    expect(screenNameFromSegments(['(app)', 'tasks', '[id]'])).toBe('tasks/[id]');
  });

  it('names the root route index', () => {
    expect(screenNameFromSegments([])).toBe('index');
    expect(screenNameFromSegments(['(app)'])).toBe('index');
  });

  it('produces names the sanitizer accepts', () => {
    const names = [
      screenNameFromSegments(['(app)', 'settings', 'privacy']),
      screenNameFromSegments(['+not-found']),
      screenNameFromSegments(['(app)', 'lists', '[...path]']),
    ];
    expect(names.every((name) => isRoutePattern(name))).toBe(true);
  });
});
