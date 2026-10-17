// src/canvas/canvas-layout.ts
'worklet';

/** Axis-aligned rectangle in canvas points; SkCanvas draw calls accept it as an SkRect as-is. */
export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** A point in canvas points (a touch, a cell centre). */
export type Point = { readonly x: number; readonly y: number };

/** A rectangular grid of square cells in canvas points (unmirrored coordinates). */
export type GridRegion = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
};

/** Pure function of the canvas size. Shared by draw() and hitTest(), so they cannot drift. */
export type CanvasLayout = {
  readonly width: number;
  readonly height: number;
  /** RTL mirroring for surfaces that opted in: positions mirror, glyphs never do. */
  readonly isMirrored: boolean;
  readonly regions: readonly GridRegion[];
};

/** A cell of a named region (a grid, a tray, a bar strip): what hit-testing returns. */
export type CanvasTarget = {
  readonly regionId: string;
  readonly col: number;
  readonly row: number;
};

/** The box to fill and the grid size to fit into it. */
export type FitInput = {
  readonly box: Rect;
  readonly cols: number;
  readonly rows: number;
};

/** The layout before the canvas has a size: no regions, so nothing is hit. */
export const EMPTY_LAYOUT: CanvasLayout = { width: 0, height: 0, isMirrored: false, regions: [] };

/** The largest whole-point square cell that fits `box`, centred in it. */
export function fitGrid(input: FitInput): Omit<GridRegion, 'id'> {
  const cell = Math.max(
    0,
    Math.floor(Math.min(input.box.width / input.cols, input.box.height / input.rows)),
  );
  return {
    x: input.box.x + Math.floor((input.box.width - cell * input.cols) / 2),
    y: input.box.y + Math.floor((input.box.height - cell * input.rows) / 2),
    cell,
    cols: input.cols,
    rows: input.rows,
  };
}

function findRegion(layout: CanvasLayout, regionId: string): GridRegion | undefined {
  return layout.regions.find((region) => region.id === regionId);
}

function mirrorRect(layout: CanvasLayout, rect: Rect): Rect {
  return layout.isMirrored ? { ...rect, x: layout.width - rect.x - rect.width } : rect;
}

/**
 * Where to draw a cell (fractional col and row work for mid-animation positions). Applies RTL
 * mirroring, so draw code never branches on direction.
 */
export function cellRect(layout: CanvasLayout, target: CanvasTarget): Rect | null {
  const region = findRegion(layout, target.regionId);
  if (region === undefined) return null;
  const rect = {
    x: region.x + target.col * region.cell,
    y: region.y + target.row * region.cell,
    width: region.cell,
    height: region.cell,
  };
  return mirrorRect(layout, rect);
}

type Probe = { readonly point: Point; readonly slop: number };

/** The x where a region is drawn: a mirrored region is mirrored as a rectangle, as cellRect does. */
function drawnLeft(layout: CanvasLayout, region: GridRegion): number {
  const width = region.cols * region.cell;
  return layout.isMirrored ? layout.width - region.x - width : region.x;
}

/** Squared distance from a point to the rectangle a region is drawn in (0 inside it). */
function drawnDistance(layout: CanvasLayout, region: GridRegion, point: Point): number {
  const left = drawnLeft(layout, region);
  const dx = Math.max(left - point.x, 0, point.x - (left + region.cols * region.cell));
  const dy = Math.max(region.y - point.y, 0, point.y - (region.y + region.rows * region.cell));
  return dx * dx + dy * dy;
}

/**
 * Hit-tests the region where it is drawn: a mirrored region is mirrored as a rectangle (as
 * cellRect does), so a cell's left edge belongs to that cell in both directions.
 */
function regionHit(layout: CanvasLayout, region: GridRegion, probe: Probe): CanvasTarget | null {
  const { slop } = probe;
  const { x, y } = probe.point;
  const width = region.cols * region.cell;
  const height = region.rows * region.cell;
  const left = drawnLeft(layout, region);
  const isInside =
    x >= left - slop &&
    x < left + width + slop &&
    y >= region.y - slop &&
    y < region.y + height + slop;
  if (!isInside || region.cell <= 0) return null;
  const drawnCol = Math.min(region.cols - 1, Math.max(0, Math.floor((x - left) / region.cell)));
  const col = layout.isMirrored ? region.cols - 1 - drawnCol : drawnCol;
  const row = Math.min(region.rows - 1, Math.max(0, Math.floor((y - region.y) / region.cell)));
  return { regionId: region.id, col, row };
}

function firstHit(layout: CanvasLayout, point: Point): CanvasTarget | null {
  for (const region of layout.regions) {
    const hit = regionHit(layout, region, { point, slop: 0 });
    if (hit !== null) return hit;
  }
  return null;
}

/** Among the regions whose slop reaches the point, the one drawn nearest to it (first on a tie). */
function nearestSlopHit(layout: CanvasLayout, point: Point, slop: number): CanvasTarget | null {
  let nearest: CanvasTarget | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const region of layout.regions) {
    const hit = regionHit(layout, region, { point, slop });
    const distance = hit === null ? nearestDistance : drawnDistance(layout, region, point);
    if (distance < nearestDistance) {
      nearest = hit;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/**
 * Canvas point → cell. `slop` (points) extends every region so edge taps still land. A region the
 * point is truly inside always wins; otherwise the nearest region whose slop reaches the point.
 */
export function hitTest(layout: CanvasLayout, point: Point, slop = 0): CanvasTarget | null {
  const exact = firstHit(layout, point);
  if (exact !== null || slop <= 0) return exact;
  return nearestSlopHit(layout, point, slop);
}

/** Structural equality for targets (send hover changes to JS only when this is false). */
export function isSameTarget(a: CanvasTarget | null, b: CanvasTarget | null): boolean {
  if (a === null || b === null) return a === b;
  return a.regionId === b.regionId && a.col === b.col && a.row === b.row;
}
