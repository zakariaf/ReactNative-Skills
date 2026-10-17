// src/core/links/link-route.ts
// The allow-list a link may open, as data. Expo Router turns every file in src/app into a URL, so
// without a list any link can open any screen with any text. Each entry names one route path, the
// kind of every dynamic segment, the query keys it keeps, and who may send it. Pure TypeScript: no
// React, React Native or Expo imports (the deep-links-and-universal-links checker loads it in Node).

/** What a dynamic segment may hold: closed patterns with a length cap. Anything else is refused. */
export const PARAM_KINDS = {
  /** A short kebab-case id: 'task-12'. */
  slug: /^[a-z0-9][a-z0-9-]{0,63}$/u,
  /** A lowercase RFC 9562 UUID. */
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  /** A non-negative integer of at most nine digits. */
  int: /^(0|[1-9]\d{0,8})$/u,
} as const;

export type ParamKind = keyof typeof PARAM_KINDS;

/** The values a link carries once checked: segment params and the kept query keys. */
export type LinkValues = Readonly<Record<string, string>>;

/**
 * One route a link may open. `THref` is the app's typed href (expo-router's Href): only gated
 * entries need `open`, because only they are opened later from JavaScript.
 */
export type LinkRouteSpec<THref = string> = {
  /** The URL path with Expo Router's dynamic segments: '/tasks/[taskId]'. Never a (group). */
  readonly path: string;
  /** The kind of every dynamic segment in `path`. */
  readonly params?: Readonly<Record<string, ParamKind>>;
  /** Query keys the screen reads; other keys are dropped. 'any' only for test-build routes. */
  readonly query?: readonly string[] | 'any';
  /** Accepted only from an https link of the app's own verified domains (a secret rides on it). */
  readonly verifiedOnly?: boolean;
  /** Development and preview builds only (the debug link). */
  readonly testBuildOnly?: boolean;
  /** The Stack.Protected guard the route sits behind ('signed-in'); the link waits while it is closed. */
  readonly gate?: string;
  /** Builds the typed href for a gated link, opened once the gate opens. */
  readonly open?: (values: LinkValues) => THref;
};

/** Longest query value a link may carry; longer text is refused, never truncated. */
export const MAX_QUERY_VALUE_LENGTH = 256;

const STATIC_SEGMENT = /^[a-z0-9][a-z0-9._~-]*$/u;
const DYNAMIC_SEGMENT = /^\[([a-z][A-Za-z0-9]*)\]$/u;
const QUERY_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;

/** The segments of a link path: '/tasks/[taskId]' -> ['tasks', '[taskId]']; '/' -> []. */
export function pathSegments(path: string): readonly string[] {
  return path.split('/').filter((segment) => segment !== '');
}

/** The param name of a dynamic segment ('[taskId]' -> 'taskId'), or null for a static one. */
export function dynamicName(segment: string): string | null {
  return DYNAMIC_SEGMENT.exec(segment)?.[1] ?? null;
}

function segmentProblems(spec: LinkRouteSpec<unknown>): string[] {
  const problems: string[] = [];
  const named = new Set<string>();
  for (const segment of pathSegments(spec.path)) {
    const name = dynamicName(segment);
    if (name === null) {
      if (!STATIC_SEGMENT.test(segment)) problems.push(`segment "${segment}" is not a URL segment`);
    } else if (spec.params?.[name] === undefined) {
      problems.push(`[${name}] has no kind in params`);
    } else {
      named.add(name);
    }
  }
  for (const name of Object.keys(spec.params ?? {})) {
    if (!named.has(name)) problems.push(`params.${name} is not a segment of the path`);
  }
  return problems;
}

function queryKeyProblems(spec: LinkRouteSpec<unknown>): string[] {
  const problems: string[] = [];
  const keys = spec.query === 'any' ? [] : (spec.query ?? []);
  const segmentNames = new Set(pathSegments(spec.path).map(dynamicName));
  for (const key of keys) {
    if (!QUERY_KEY.test(key)) problems.push(`query key "${key}" is not a plain name`);
    // open() receives segment and query values in one object: a same-named key would replace the
    // kind-checked segment value with unchecked text.
    if (segmentNames.has(key)) problems.push(`query key "${key}" shadows a path param`);
  }
  return problems;
}

function optionProblems(spec: LinkRouteSpec<unknown>): string[] {
  const problems: string[] = [];
  if (!spec.path.startsWith('/')) problems.push('path must start with /');
  if (spec.query === 'any' && spec.testBuildOnly !== true) {
    problems.push("query 'any' is for test-build routes only");
  }
  problems.push(...queryKeyProblems(spec));
  if (spec.gate !== undefined && spec.open === undefined) {
    problems.push(`gate "${spec.gate}" needs open() to reopen the link after the gate opens`);
  }
  return problems;
}

/** Every problem of a link table, as 'path: problem' lines; empty when the table is sound. */
export function linkRouteProblems(routes: readonly LinkRouteSpec<unknown>[]): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const spec of routes) {
    if (seen.has(spec.path)) problems.push(`${spec.path}: listed twice`);
    seen.add(spec.path);
    for (const problem of [...optionProblems(spec), ...segmentProblems(spec)]) {
      problems.push(`${spec.path}: ${problem}`);
    }
  }
  return problems;
}
