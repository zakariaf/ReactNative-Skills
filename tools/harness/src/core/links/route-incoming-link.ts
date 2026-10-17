// src/core/links/route-incoming-link.ts
// The one decision for every incoming link, cold start and warm alike: home, open one allow-listed
// route with checked values, wait behind a closed gate, or refuse. src/app/+native-intent.tsx calls
// it for every URL Expo Router receives; the deep-links-and-universal-links checker replays hostile
// URLs through it. The href it builds is re-encoded, so a decoded '&' or '/' can never become a new
// query key or path segment. Pure TypeScript.
import { parseIncomingLink } from './incoming-link';
import { MAX_QUERY_VALUE_LENGTH, PARAM_KINDS, dynamicName, pathSegments } from './link-route';

import type { LinkOrigins, LinkRefusal, ParsedLink } from './incoming-link';
import type { LinkRouteSpec, LinkValues } from './link-route';

/** Everything the decision needs: where links may come from, the allow-list, the build kind. */
export type LinkPolicy<THref = string> = LinkOrigins & {
  readonly routes: readonly LinkRouteSpec<THref>[];
  /** Development and preview builds (testBuildOnly routes open only there). */
  readonly isTestBuild: boolean;
};

export type LinkDecision<THref = string> =
  | { readonly kind: 'home' }
  | { readonly kind: 'open'; readonly href: string; readonly path: string }
  | { readonly kind: 'deferred'; readonly gate: string; readonly target: THref }
  | { readonly kind: 'refused'; readonly reason: LinkRefusal };

/** Whether a Stack.Protected gate is open right now (unknown gates are closed). */
export type GateCheck = (gate: string) => boolean;

type Match<THref> = { readonly spec: LinkRouteSpec<THref>; readonly values: LinkValues };

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

function refused<THref>(reason: LinkRefusal): LinkDecision<THref> {
  return { kind: 'refused', reason };
}

/** The table may come from a stale build or plain JS: an unknown kind matches nothing. */
const KIND_PATTERNS: Readonly<Partial<Record<string, RegExp>>> = PARAM_KINDS;

function kindMatches(kind: string | undefined, value: string): boolean {
  const pattern = kind === undefined ? undefined : KIND_PATTERNS[kind];
  return pattern?.test(value) === true;
}

/** Segment params of `spec` for `segments`, or null when a static segment or a kind does not match. */
function matchValues<THref>(
  spec: LinkRouteSpec<THref>,
  segments: readonly string[],
): LinkValues | null {
  const pattern = pathSegments(spec.path);
  if (pattern.length !== segments.length) return null;
  const values: Record<string, string> = {};
  for (const [index, part] of pattern.entries()) {
    const actual = segments[index] ?? '';
    const name = dynamicName(part);
    if (name === null) {
      if (part !== actual) return null;
    } else {
      if (!kindMatches(spec.params?.[name], actual)) return null;
      values[name] = actual;
    }
  }
  return values;
}

/** The matching route with the most static segments ('/tasks/new' beats '/tasks/[taskId]'). */
function bestMatch<THref>(
  routes: readonly LinkRouteSpec<THref>[],
  segments: readonly string[],
): Match<THref> | null {
  let best: Match<THref> | null = null;
  let bestStatic = -1;
  for (const spec of routes) {
    const values = matchValues(spec, segments);
    const staticCount = pathSegments(spec.path).filter((part) => dynamicName(part) === null).length;
    if (values !== null && staticCount > bestStatic) {
      best = { spec, values };
      bestStatic = staticCount;
    }
  }
  return best;
}

/** True when some route has the right shape but a value of the wrong kind (bad-param, not unknown). */
function shapeMatches<THref>(
  routes: readonly LinkRouteSpec<THref>[],
  segments: readonly string[],
): boolean {
  return routes.some((spec) => {
    const pattern = pathSegments(spec.path);
    return (
      pattern.length === segments.length &&
      pattern.every((part, index) => dynamicName(part) !== null || part === segments[index])
    );
  });
}

/** The query pairs the route keeps; unknown keys (utm_source, fbclid) are dropped. */
function keptQuery<THref>(
  spec: LinkRouteSpec<THref>,
  query: ParsedLink['query'],
): readonly (readonly [string, string])[] | LinkRefusal {
  if (spec.query === 'any') return query;
  const allowed = new Set(spec.query ?? []);
  const kept = query.filter(([key]) => allowed.has(key));
  const keys = kept.map(([key]) => key);
  if (new Set(keys).size !== keys.length) return 'repeated-query';
  const isBad = kept.some(
    ([, value]) => value.length > MAX_QUERY_VALUE_LENGTH || CONTROL_CHARACTER.test(value),
  );
  return isBad ? 'bad-query' : kept;
}

/** The internal href, every piece re-encoded: '/tasks/task-7?highlight=a%26b'. */
export function buildLinkHref(
  path: string,
  values: LinkValues,
  query: readonly (readonly [string, string])[],
): string {
  const segments = pathSegments(path).map((part) => {
    const name = dynamicName(part);
    return name === null ? part : encodeURIComponent(values[name] ?? '');
  });
  const search = query.map(
    ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
  );
  return `/${segments.join('/')}${search.length > 0 ? `?${search.join('&')}` : ''}`;
}

function routeRefusal<THref>(
  spec: LinkRouteSpec<THref>,
  link: ParsedLink,
  policy: LinkPolicy<THref>,
): LinkRefusal | null {
  if (spec.testBuildOnly === true && !policy.isTestBuild) return 'test-build-only';
  if (spec.verifiedOnly === true && link.origin !== 'web') return 'unverified-origin';
  return null;
}

/** Decides what `raw` opens. Never throws; anything unexpected is a refusal. */
export function routeIncomingLink<THref>(
  raw: string,
  policy: LinkPolicy<THref>,
  isGateOpen: GateCheck,
): LinkDecision<THref> {
  const parsed = parseIncomingLink(raw, policy);
  if (!parsed.ok) return refused(parsed.error.reason);
  const link = parsed.value;
  if (link.segments.length === 0) return { kind: 'home' };
  const match = bestMatch(policy.routes, link.segments);
  if (match === null)
    return refused(shapeMatches(policy.routes, link.segments) ? 'bad-param' : 'unknown-route');
  const refusal = routeRefusal(match.spec, link, policy);
  if (refusal !== null) return refused(refusal);
  const query = keptQuery(match.spec, link.query);
  if (typeof query === 'string') return refused(query);
  const { gate, open } = match.spec;
  if (gate !== undefined && !isGateOpen(gate)) {
    if (open === undefined) return refused('unknown-route');
    // The checked segment values go last: a query key can never replace one (the table checks refuse
    // a shadowing key too).
    return {
      kind: 'deferred',
      gate,
      target: open({ ...Object.fromEntries(query), ...match.values }),
    };
  }
  return {
    kind: 'open',
    href: buildLinkHref(match.spec.path, match.values, query),
    path: match.spec.path,
  };
}
