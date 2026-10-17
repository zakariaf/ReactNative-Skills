// src/features/__DETAIL__/__DETAIL__-params.ts
// The params of the route src/app/__DETAIL_ROUTE_ID__.tsx, parsed at the edge. Every Expo Router route
// is a URL: a deep link, a notification or a mistyped shared link can open it with any text, a
// repeated query key arrives as an array, and the type argument of useLocalSearchParams<...>() is a
// cast, not a check. The model parses the raw params here and shows the invalid-link state on a
// failure. Ids stay short plain values; never pass a whole object through the URL.
import * as v from 'valibot';

import { err, ok } from '@/core/result';

import type { Result } from '@/core/result';

/** Ids are short kebab-case slugs ('item-12'); anything else names nothing. */
const PARAMS_SCHEMA = v.object({
  __PARAM__: v.pipe(v.string(), v.regex(/^[a-z0-9][a-z0-9-]{0,63}$/u)),
});

export type __DETAIL_PASCAL__Params = { readonly __PARAM__: string };

export type __DETAIL_PASCAL__ParamsFailure = { readonly kind: 'invalid-route-params' };

/** What useLocalSearchParams() hands back: strings, arrays for repeated keys, or nothing. */
export type RawRouteParams = Readonly<Record<string, string | readonly string[] | undefined>>;

/** The id from the route params, or a failure the screen shows as its invalid-link state. */
export function parse__DETAIL_PASCAL__Params(
  raw: RawRouteParams,
): Result<__DETAIL_PASCAL__Params, __DETAIL_PASCAL__ParamsFailure> {
  const parsed = v.safeParse(PARAMS_SCHEMA, raw);
  if (!parsed.success) return err({ kind: 'invalid-route-params' });
  return ok({ __PARAM__: parsed.output.__PARAM__ });
}
