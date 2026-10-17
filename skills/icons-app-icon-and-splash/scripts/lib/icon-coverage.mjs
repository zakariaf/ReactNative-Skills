// icon-coverage.mjs: compares a generated icon path (one nonzero fill) with the layers it was built
// from, without Skia. Both are sampled on a grid over the 24-unit box: the generated path by its
// winding number, the layers exactly (fills by their rule, round-joined strokes by distance to the
// centre line, butt caps cut square). Points close to either outline are skipped, so only a real
// change of shape (an edited, stale or swapped path) is counted.

import { flattenPath } from './svg-path.mjs';

/** Grid step in icon units: 96 x 96 samples on the 24 grid (4 per unit, about 1 per pixel at 4x). */
const STEP = 0.25;
/**
 * Samples nearer than this to either outline are not judged: Skia's stroker and its quad output
 * sit up to about 0.14 units off the exact outline (under a pixel at 44 pt and 3x).
 */
const EDGE_TOLERANCE = 0.2;

function segments(subpaths, { close }) {
  const out = [];
  for (const { points, closed } of subpaths) {
    const count = points.length;
    const last = closed || close ? count : count - 1;
    for (let i = 0; i < last; i += 1) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[(i + 1) % count];
      out.push({ x0, y0, x1, y1, isFirst: i === 0 && !closed, isLast: i === count - 2 && !closed });
    }
  }
  return out;
}

function winding(segs, x, y) {
  let count = 0;
  for (const { x0, y0, x1, y1 } of segs) {
    const side = (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0);
    if (y0 <= y) {
      if (y1 > y && side > 0) count += 1;
    } else if (y1 <= y && side < 0) {
      count -= 1;
    }
  }
  return count;
}

/** Squared distance from (x, y) to a segment; Infinity where a butt cap cuts the end off. */
function distance2(seg, x, y, isButt) {
  const dx = seg.x1 - seg.x0;
  const dy = seg.y1 - seg.y0;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((x - seg.x0) * dx + (y - seg.y0) * dy) / len2;
  if (isButt && ((seg.isFirst && t < 0) || (seg.isLast && t > 1))) return Infinity;
  t = Math.max(0, Math.min(1, t));
  const px = seg.x0 + t * dx - x;
  const py = seg.y0 + t * dy - y;
  return px * px + py * py;
}

function prepareLayer(layer) {
  const subpaths = flattenPath(layer.d, 16);
  if (layer.op === 'fill') return { op: 'fill', evenOdd: layer.fillRule === 'evenodd', segs: segments(subpaths, { close: true }) };
  return { op: 'stroke', half2: (layer.width / 2) ** 2, isButt: layer.cap === 'butt', segs: segments(subpaths, { close: false }) };
}

/** Distance from (x, y) to the nearest layer outline (fill edges, stroke band edges). */
function layerEdgeDistance(prepared, x, y) {
  let best = Infinity;
  for (const layer of prepared) {
    for (const seg of layer.segs) {
      const d2 = distance2(seg, x, y, layer.op === 'stroke' && layer.isButt);
      if (d2 === Infinity) continue;
      best = Math.min(best, layer.op === 'fill' ? Math.sqrt(d2) : Math.abs(Math.sqrt(d2) - Math.sqrt(layer.half2)));
    }
  }
  return best;
}

function layersCover(prepared, x, y) {
  for (const layer of prepared) {
    if (layer.op === 'fill') {
      const count = winding(layer.segs, x, y);
      if (layer.evenOdd ? count % 2 !== 0 : count !== 0) return true;
    } else if (layer.segs.some((seg) => distance2(seg, x, y, layer.isButt) <= layer.half2)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns { judged, mismatched, example } where `example` is the first differing sample
 * ({ x, y, generated: boolean }) or null. Throws on unreadable path data.
 */
export function compareIconCoverage(generatedD, layers) {
  const generated = segments(flattenPath(generatedD, 8), { close: true });
  const prepared = layers.map(prepareLayer);
  const edge2 = EDGE_TOLERANCE ** 2;
  let judged = 0;
  let mismatched = 0;
  let example = null;
  for (let y = STEP / 2; y < 24; y += STEP) {
    for (let x = STEP / 2; x < 24; x += STEP) {
      if (generated.some((seg) => distance2(seg, x, y, false) < edge2)) continue;
      judged += 1;
      const isGenerated = winding(generated, x, y) !== 0;
      if (isGenerated !== layersCover(prepared, x, y) && layerEdgeDistance(prepared, x, y) >= EDGE_TOLERANCE) {
        mismatched += 1;
        example ??= { x, y, generated: isGenerated };
      }
    }
  }
  return { judged, mismatched, example };
}
