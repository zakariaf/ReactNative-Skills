// src/core/portable/canonical-json.test.ts
import { canonicalJson, isJsonObject, parseJson } from './canonical-json';

describe('canonicalJson', () => {
  it('sorts keys at every depth and writes no whitespace', () => {
    const value = { b: [{ z: 1, a: 'x' }], a: { d: null, c: true } };
    expect(canonicalJson(value)).toBe('{"a":{"c":true,"d":null},"b":[{"a":"x","z":1}]}');
  });

  it('gives the same text for the same value built in another key order', () => {
    expect(canonicalJson({ id: 1, title: 't' })).toBe(canonicalJson({ title: 't', id: 1 }));
  });

  it('keeps hostile strings exactly: quotes, newlines, bidi marks, emoji, whitespace', () => {
    const title = 'He said "hi",\r\n\u200Fمرحبا\u200F 📊 \t ';
    const text = canonicalJson({ title });
    expect(parseJson(text)).toStrictEqual({ title });
    expect(text).toBe(`{"title":${JSON.stringify(title)}}`);
  });

  it('keeps the largest safe integer and keeps null apart from the empty string', () => {
    const value = { big: Number.MAX_SAFE_INTEGER, empty: '', none: null };
    expect(parseJson(canonicalJson(value))).toStrictEqual(value);
  });

  it('refuses a number JSON cannot hold instead of writing null', () => {
    expect(() => canonicalJson({ ratio: Number.NaN })).toThrow(RangeError);
    expect(() => canonicalJson([Number.POSITIVE_INFINITY])).toThrow('not a JSON number: Infinity');
  });
});

describe('parseJson and isJsonObject', () => {
  it('returns undefined for text that is not JSON, and tells objects from arrays and null', () => {
    expect(parseJson('{"truncated":')).toBeUndefined();
    expect(parseJson('list,title\r\n')).toBeUndefined();
    expect(isJsonObject(parseJson('{"a":1}'))).toBe(true);
    expect(isJsonObject(parseJson('[1]'))).toBe(false);
    expect(isJsonObject(parseJson('null'))).toBe(false);
  });
});
