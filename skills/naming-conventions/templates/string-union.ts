// src/features/__FEATURE__/__UNION_FILE__.ts
// A closed set of names: the values exist at runtime (an `as const` array, UPPER_CASE) and the type
// is derived from them (PascalCase), so the two never drift. This replaces an enum, which
// erasableSyntaxOnly rejects.

/** Every __UNION_PASCAL__, in display order. */
export const __VALUES_CONST__ = [__VALUES__] as const;

/** One of __VALUES_CONST__. */
export type __UNION_PASCAL__ = (typeof __VALUES_CONST__)[number];

/** Narrows unknown input (a stored field, a route param) to __UNION_PASCAL__. */
export function is__UNION_PASCAL__(value: unknown): value is __UNION_PASCAL__ {
  return __VALUES_CONST__.some((item) => item === value);
}
