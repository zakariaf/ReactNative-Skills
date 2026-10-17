// src/core/links/incoming-link.ts
// Reads an incoming URL into checked parts before anything routes on it. A link is untrusted input:
// any app or web page can send one (an Android app can fire an explicit intent at the app with any
// URL, even one of its own https domains), so the scheme, host, user info, port and encoding are
// checked here and every refusal is a value, never a throw. Uses the WHATWG URL parser, which Node
// and Expo's runtime (expo/winter, whatwg-url-minimum) share. Pure TypeScript.
import { attempt, err, ok } from '@/core/result';

import type { Result } from '@/core/result';

/** Where a link may come from: the app's own custom schemes and its verified web hosts. */
export type LinkOrigins = {
  /** Custom schemes this build accepts, lowercase ('tasks', 'tasks-dev'): the config's `scheme` entries. */
  readonly schemes: readonly string[];
  /** Verified web hosts: 'tasks.example.com', or '*.example.com' for every subdomain. */
  readonly hosts: readonly string[];
};

/** Why a link opens nothing. Logged and tested; never shown with the URL. */
export type LinkRefusal =
  | 'too-long'
  | 'unparsable'
  | 'foreign-scheme'
  | 'foreign-host'
  | 'credentials'
  | 'port'
  | 'bad-encoding'
  | 'unknown-route'
  | 'bad-param'
  | 'bad-query'
  | 'repeated-query'
  | 'test-build-only'
  | 'unverified-origin';

/** A refusal as a Result failure (error-handling-typed-results: a kebab-case kind, typed params). */
export type LinkRefused = { readonly kind: 'link-refused'; readonly reason: LinkRefusal };

/** A link's checked parts: decoded path segments and raw query pairs, with where it came from. */
export type ParsedLink = {
  /** 'web': an http(s) link of a verified host (no other app can receive it); 'app-scheme': anyone's. */
  readonly origin: 'web' | 'app-scheme';
  readonly segments: readonly string[];
  readonly query: readonly (readonly [string, string])[];
};

/** URLs longer than this are refused before parsing (2048, a common browser and server limit). */
export const MAX_LINK_LENGTH = 2048;

const WEB_SCHEMES = new Set(['http', 'https']);

/** True when `host` is one of `patterns`, or a subdomain of a '*.example.com' pattern. */
export function hostMatches(host: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) =>
    pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern,
  );
}

const refusal = (reason: LinkRefusal): LinkRefused => ({ kind: 'link-refused', reason });
const refuse = (reason: LinkRefusal): Result<never, LinkRefused> => err(refusal(reason));

/** The parsed URL; a string the WHATWG parser rejects is the expected answer 'unparsable'. */
function toUrl(raw: string): Result<URL, LinkRefused> {
  // A bare path ('/tasks/7') arrives in tests and from the router itself; it is no more trusted.
  const isPath = raw.startsWith('/') && !raw.startsWith('//');
  return attempt(
    () => (isPath ? new URL(raw, 'app-path:///') : new URL(raw)),
    () => refusal('unparsable'),
  );
}

function originOf(url: URL, origins: LinkOrigins): Result<ParsedLink['origin'], LinkRefused> {
  const scheme = url.protocol.slice(0, -1);
  if (url.username !== '' || url.password !== '') return refuse('credentials');
  if (url.port !== '') return refuse('port');
  if (WEB_SCHEMES.has(scheme)) {
    return hostMatches(url.hostname, origins.hosts) ? ok('web') : refuse('foreign-host');
  }
  const isOwnScheme = scheme === 'app-path' || origins.schemes.includes(scheme);
  return isOwnScheme ? ok('app-scheme') : refuse('foreign-scheme');
}

/** Raw path pieces: a custom scheme's host is the first segment ('tasks://tasks/7' -> tasks, 7). */
function rawSegments(url: URL, origin: ParsedLink['origin']): readonly string[] | null {
  const pieces = url.pathname.split('/');
  if (pieces[0] === '') pieces.shift();
  if (pieces.at(-1) === '') pieces.pop();
  if (pieces.includes('')) return null;
  return origin === 'app-scheme' && url.hostname !== '' ? [url.hostname, ...pieces] : pieces;
}

/** Each piece decoded once; a malformed escape ('%E0%A4%A') is the expected answer 'bad-encoding'. */
function decodeSegments(pieces: readonly string[]): Result<readonly string[], LinkRefused> {
  return attempt(
    () => pieces.map((piece) => decodeURIComponent(piece)),
    () => refusal('bad-encoding'),
  );
}

/** The checked parts of `raw`, or why it is refused. Never throws. */
export function parseIncomingLink(
  raw: string,
  origins: LinkOrigins,
): Result<ParsedLink, LinkRefused> {
  if (raw.length > MAX_LINK_LENGTH) return refuse('too-long');
  const url = toUrl(raw);
  if (!url.ok) return url;
  const origin = originOf(url.value, origins);
  if (!origin.ok) return origin;
  const pieces = rawSegments(url.value, origin.value);
  if (pieces === null) return refuse('unparsable');
  const segments = decodeSegments(pieces);
  if (!segments.ok) return segments;
  return ok({
    origin: origin.value,
    segments: segments.value,
    query: [...url.value.searchParams.entries()],
  });
}
