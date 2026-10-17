// src/features/list-detail/list-detail-params.ts
// The scaffold's parser, grown for numeric database ids: the Tasks repository keys lists by an
// integer, so the URL segment must be a positive whole number and leaves here as a number. The
// schema key still equals the bracket name of src/app/(app)/lists/[listId].tsx.
import * as v from 'valibot';

import { err, ok } from '@/core/result';

import type { Result } from '@/core/result';

const PARAMS_SCHEMA = v.object({
  listId: v.pipe(v.string(), v.regex(/^[1-9]\d{0,11}$/u), v.transform(Number)),
});

export type ListDetailParams = { readonly listId: number };

export type ListDetailParamsFailure = { readonly kind: 'invalid-route-params' };

/** What useLocalSearchParams() hands back: strings, arrays for repeated keys, or nothing. */
export type RawRouteParams = Readonly<Record<string, string | readonly string[] | undefined>>;

/** The list id from the route params, or a failure the screen shows as its invalid-link state. */
export function parseListDetailParams(
  raw: RawRouteParams,
): Result<ListDetailParams, ListDetailParamsFailure> {
  const parsed = v.safeParse(PARAMS_SCHEMA, raw);
  if (!parsed.success) return err({ kind: 'invalid-route-params' });
  return ok({ listId: parsed.output.listId });
}
