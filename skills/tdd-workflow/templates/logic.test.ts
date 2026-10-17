// src/features/__FEATURE__/__UNIT_FILE__.test.ts
// __REQUIREMENT_ID__: "__REQUIREMENT_QUOTE__"
// Order inside the file: examples (the requirement's sentences, at least one pinned exact value), a
// table for the rule matrix (each limit at exactly its value and one past it), then fast-check
// properties. A unit that rejects impossible input adds describe('when the input is impossible')
// with toThrow(RangeError) before the properties.
import fc from 'fast-check';

import { __UNIT_CAMEL__ } from './__UNIT_FILE__';

type Args = Parameters<typeof __UNIT_CAMEL__>;
type Result = ReturnType<typeof __UNIT_CAMEL__>;

/** Valid arguments for the unit; fast-check shrinks a failing case to the smallest of them. */
const argsArb: fc.Arbitrary<Args> = __ARGS_ARBITRARY__;

/** True when a result keeps the unit's invariant (the property below checks it for any valid input). */
function __INVARIANT_CAMEL__(result: Result, args: Args): boolean {
  return __INVARIANT_EXPRESSION__;
}

describe('__UNIT_CAMEL__', () => {
  // Pinned exact value. __EQUALITY_MATCHER__ is toBe for a number, string or boolean literal (the
  // lint rule jest/prefer-to-be rejects toStrictEqual there) and toStrictEqual for an object or array.
  it('__EXAMPLE_TITLE__ (__REQUIREMENT_ID__)', () => {
    expect(__UNIT_CAMEL__(__EXAMPLE_ARGS__)).__EQUALITY_MATCHER__(__EXAMPLE_RESULT__);
  });

  it.each<[Args, Result]>(__RULE_TABLE__)('__TABLE_TITLE__', (args, expected) => {
    expect(__UNIT_CAMEL__(...args)).toStrictEqual(expected);
  });

  describe('properties', () => {
    it('returns the same result for the same input', () => {
      fc.assert(
        fc.property(argsArb, (args) => {
          expect(__UNIT_CAMEL__(...args)).toStrictEqual(__UNIT_CAMEL__(...args));
        }),
      );
    });

    it('__INVARIANT_TITLE__', () => {
      fc.assert(
        fc.property(argsArb, (args) => {
          expect(__INVARIANT_CAMEL__(__UNIT_CAMEL__(...args), args)).toBe(true);
        }),
      );
    });
  });
});
