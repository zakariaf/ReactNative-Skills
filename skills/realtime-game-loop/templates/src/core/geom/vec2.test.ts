// src/core/geom/vec2.test.ts
import { add, dot, length, normalize, reflect, scale, sub, ZERO } from './vec2';

describe('vec2', () => {
  it('adds, subtracts and scales component by component', () => {
    expect(add({ x: 1, y: 2 }, { x: 3, y: -5 })).toStrictEqual({ x: 4, y: -3 });
    expect(sub({ x: 1, y: 2 }, { x: 3, y: -5 })).toStrictEqual({ x: -2, y: 7 });
    expect(scale({ x: 1.5, y: -2 }, 4)).toStrictEqual({ x: 6, y: -8 });
  });

  it('measures with the dot product and the correctly rounded square root', () => {
    expect(dot({ x: 2, y: 3 }, { x: 4, y: -1 })).toBe(5);
    expect(length({ x: 3, y: 4 })).toBe(5);
  });

  it('normalises to unit length, and a zero vector to ZERO', () => {
    expect(normalize({ x: 0, y: -8 })).toStrictEqual({ x: 0, y: -1 });
    expect(normalize(ZERO)).toBe(ZERO);
  });

  it('reflects a velocity off a surface normal without angles', () => {
    expect(reflect({ x: 3, y: 4 }, { x: 0, y: -1 })).toStrictEqual({ x: 3, y: -4 });
    expect(reflect({ x: -2, y: 0 }, { x: 1, y: 0 })).toStrictEqual({ x: 2, y: 0 });
  });
});
