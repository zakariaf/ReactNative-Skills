// src/api/build-url.ts
// Joins the base URL, a path and query parameters by string, on purpose: new URL('/tasks', base)
// resolves the path against the host and drops the base's own path ('.../v1/' + '/tasks' becomes
// '.../tasks'), so a base URL with a version prefix would silently call the wrong endpoint.
import type { QueryParams } from './api-client';

/** The base URL without trailing slashes ('…/v1/' and '…/v1' mean the same base). */
function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/u, '');
}

/** `a=1&b=x%20y` from the defined parameters, in their given order (undefined is left out). */
export function encodeQuery(query: QueryParams): string {
  return Object.entries(query)
    .flatMap(([name, value]) =>
      value === undefined ? [] : [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`],
    )
    .join('&');
}

/**
 * The full URL of `path` (which starts with '/') below `baseUrl`, with the query string. A path
 * without the leading slash is a programmer error and throws, so it fails in the first test.
 */
export function buildUrl(baseUrl: string, path: string, query: QueryParams = {}): string {
  if (!path.startsWith('/')) {
    throw new Error(`API paths start with "/": got "${path}"`);
  }
  const search = encodeQuery(query);
  return `${trimBase(baseUrl)}${path}${search === '' ? '' : `?${search}`}`;
}
