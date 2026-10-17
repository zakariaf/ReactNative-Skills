// src/core/geom/spatial-hash.ts
'worklet';

/**
 * Uniform-grid broad phase built by counting sort into caller-owned typed arrays,
 * so a per-tick rebuild on the UI thread allocates nothing (the typed-array
 * exception: writes go through local aliases of the scratch buffers).
 * cellStart/cursor have cols*rows+1 entries; items has one entry per entity.
 * Entities of cell c are items[cellStart[c]] … items[cellStart[c+1] - 1].
 */
export type SpatialHash = {
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  readonly cellStart: Int32Array;
  readonly cursor: Int32Array;
  readonly items: Int32Array;
};

/** Allocates the scratch buffers once (at sim creation), never per tick. */
export function makeSpatialHash(
  grid: { cellSize: number; cols: number; rows: number },
  capacity: number,
): SpatialHash {
  const cells = grid.cols * grid.rows + 1;
  return {
    ...grid,
    cellStart: new Int32Array(cells),
    cursor: new Int32Array(cells),
    items: new Int32Array(capacity),
  };
}

/** Grid cell index of a point, clamped to the grid. */
export function cellOf(hash: SpatialHash, x: number, y: number): number {
  const col = Math.min(hash.cols - 1, Math.max(0, Math.floor(x / hash.cellSize)));
  const row = Math.min(hash.rows - 1, Math.max(0, Math.floor(y / hash.cellSize)));
  return row * hash.cols + col;
}

function entityCell(hash: SpatialHash, positions: Float32Array, index: number): number {
  return cellOf(hash, positions[index * 2] ?? 0, positions[index * 2 + 1] ?? 0);
}

/** Rebuilds `out` from interleaved positions [x0, y0, x1, y1, …] of `count` entities. */
export function rebuildSpatialHash(out: SpatialHash, positions: Float32Array, count: number): void {
  const starts = out.cellStart;
  starts.fill(0);
  for (let i = 0; i < count; i += 1) {
    const next = entityCell(out, positions, i) + 1;
    starts[next] = (starts[next] ?? 0) + 1;
  }
  for (let c = 1; c < starts.length; c += 1) starts[c] = (starts[c] ?? 0) + (starts[c - 1] ?? 0);
  const { cursor, items } = out;
  cursor.set(starts);
  for (let i = 0; i < count; i += 1) {
    const cell = entityCell(out, positions, i);
    const slot = cursor[cell] ?? 0;
    items[slot] = i;
    cursor[cell] = slot + 1;
  }
}
