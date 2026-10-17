// src/features/__FEATURE__/canvas/canvas-ids.test.ts
import { CHANGE_ENTITY, cellEntity } from './canvas-ids';

describe('cellEntity', () => {
  it('gives every cell its own entity, apart from the change entity', () => {
    const ids = Array.from({ length: 42 }, (_, index) => cellEntity(index));
    expect(new Set(ids).size).toBe(42);
    expect(ids).not.toContain(CHANGE_ENTITY);
  });
});
