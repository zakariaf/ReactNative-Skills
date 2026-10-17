// src/core/geom/spatial-hash.test.ts
import { cellOf, makeSpatialHash, rebuildSpatialHash } from './spatial-hash';

import type { SpatialHash } from './spatial-hash';

/** Entities of one grid cell, read back the way a collision pass does. */
function entitiesIn(hash: SpatialHash, cell: number): number[] {
  const out: number[] = [];
  for (let i = hash.cellStart[cell] ?? 0; i < (hash.cellStart[cell + 1] ?? 0); i += 1) {
    out.push(hash.items[i] ?? -1);
  }
  return out;
}

describe('spatial hash', () => {
  it('buckets every entity into the cell under its position', () => {
    const hash = makeSpatialHash({ cellSize: 100, cols: 4, rows: 4 }, 8);
    const positions = new Float32Array([10, 10, 150, 20, 160, 30, 390, 390]);
    rebuildSpatialHash(hash, positions, 4);
    expect(entitiesIn(hash, cellOf(hash, 10, 10))).toStrictEqual([0]);
    expect(entitiesIn(hash, cellOf(hash, 150, 20))).toStrictEqual([1, 2]);
    expect(entitiesIn(hash, cellOf(hash, 390, 390))).toStrictEqual([3]);
  });

  it('clamps positions outside the grid into the edge cells', () => {
    const hash = makeSpatialHash({ cellSize: 100, cols: 4, rows: 4 }, 1);
    expect(cellOf(hash, -50, 9999)).toBe(12);
  });

  it('reuses its buffers on every rebuild (no per-tick allocation)', () => {
    const hash = makeSpatialHash({ cellSize: 100, cols: 2, rows: 2 }, 2);
    const { items } = hash;
    rebuildSpatialHash(hash, new Float32Array([10, 10, 150, 150]), 2);
    rebuildSpatialHash(hash, new Float32Array([150, 150, 10, 10]), 2);
    expect(hash.items).toBe(items);
    expect(entitiesIn(hash, 0)).toStrictEqual([1]);
  });
});
