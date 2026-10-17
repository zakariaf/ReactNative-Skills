// src/services/analytics/screen-name.ts
// The screen name analytics may send: the route pattern from expo-router's segments, with layout
// groups removed ('(app)', 'tasks', '[id]' -> 'tasks/[id]'). Never usePathname() and never the
// params: a concrete path carries ids, search terms and anything else the URL holds.

/** Joins route segments into a pattern; groups dropped, the root is 'index'. */
export function screenNameFromSegments(segments: readonly string[]): string {
  const visible = segments.filter((segment) => !/^\(.*\)$/.test(segment));
  return visible.length === 0 ? 'index' : visible.join('/');
}
