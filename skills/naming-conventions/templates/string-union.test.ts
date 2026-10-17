// src/features/__FEATURE__/__UNION_FILE__.test.ts
import { __VALUES_CONST__, is__UNION_PASCAL__ } from './__UNION_FILE__';

describe('is__UNION_PASCAL__', () => {
  it('accepts every declared value', () => {
    expect(__VALUES_CONST__.every((value) => is__UNION_PASCAL__(value))).toBe(true);
  });

  it('rejects anything else', () => {
    expect(is__UNION_PASCAL__('not-a-value')).toBe(false);
    expect(is__UNION_PASCAL__(undefined)).toBe(false);
  });
});
