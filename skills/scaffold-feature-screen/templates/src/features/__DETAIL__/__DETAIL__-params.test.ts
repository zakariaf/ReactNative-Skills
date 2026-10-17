// src/features/__DETAIL__/__DETAIL__-params.test.ts
import { parse__DETAIL_PASCAL__Params } from './__DETAIL__-params';

describe('parse__DETAIL_PASCAL__Params', () => {
  it('reads the id from the route params', () => {
    expect(parse__DETAIL_PASCAL__Params({ __PARAM__: 'item-12' })).toStrictEqual({
      ok: true,
      value: { __PARAM__: 'item-12' },
    });
  });

  it('ignores extra query params', () => {
    expect(parse__DETAIL_PASCAL__Params({ __PARAM__: 'item-12', utm: 'mail' })).toStrictEqual({
      ok: true,
      value: { __PARAM__: 'item-12' },
    });
  });

  it('accepts an id of exactly 64 characters', () => {
    const id = 'a'.repeat(64);
    expect(parse__DETAIL_PASCAL__Params({ __PARAM__: id })).toStrictEqual({
      ok: true,
      value: { __PARAM__: id },
    });
  });

  it.each([
    ['a missing id', {}],
    ['an empty id', { __PARAM__: '' }],
    ['a repeated key (an array)', { __PARAM__: ['item-1', 'item-2'] }],
    ['a path inside the id', { __PARAM__: '../settings' }],
    ['an upper-case id', { __PARAM__: 'Item-1' }],
    ['an id of 65 characters', { __PARAM__: 'a'.repeat(65) }],
  ])('rejects %s', (_label, raw) => {
    expect(parse__DETAIL_PASCAL__Params(raw)).toStrictEqual({
      ok: false,
      error: { kind: 'invalid-route-params' },
    });
  });
});
