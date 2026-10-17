// src/core/portable/sha256.test.ts
import { sha256Hex } from './sha256';
import { utf8ByteLength, utf8Bytes } from './utf8';

describe('sha256Hex', () => {
  it('matches the FIPS 180-4 examples', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('hashes the empty string and every padding boundary (55, 56 and 64 bytes)', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('x'.repeat(55))).toBe(
      'd5e285683cd4efc02d021a5c62014694958901005d6f71e89e0989fac77e4072',
    );
    expect(sha256Hex('x'.repeat(56))).toBe(
      '04c26261370ee7541549d16dee320c723e3fd14671e66a099afe0a377c16888e',
    );
    expect(sha256Hex('x'.repeat(64))).toBe(
      '7ce100971f64e7001e8fe5a51973ecdfe1ced42befe7ee8d5fd6219506b5393c',
    );
    expect(sha256Hex('a'.repeat(1000))).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    );
  });

  it("hashes UTF-8 bytes, as Node's createHash(...).update(text, 'utf8') does", () => {
    expect(sha256Hex('شراء الحليب 📊')).toBe(
      'c69a6c72869698f15e4e1ad7c4d603a2c010ae4d48d10d84666d3dba126d1050',
    );
    expect(sha256Hex('\uD800x')).toBe(
      'a87ce46793cc659b79bd187e998f8488635f707d5be0957e1d565981efd2b04b',
    );
  });
});

describe('utf8Bytes', () => {
  it('encodes one to four bytes per code point and replaces a lone surrogate', () => {
    expect([...utf8Bytes('aé€\u{1F4CA}')]).toStrictEqual([
      0x61, 0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x93, 0x8a,
    ]);
    expect([...utf8Bytes('\uDC00')]).toStrictEqual([0xef, 0xbf, 0xbd]);
    expect(utf8ByteLength('a\u00e9\u20ac\u{1F4CA}\uDC00')).toBe(13);
  });
});
