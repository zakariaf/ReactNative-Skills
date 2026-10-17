// svg-path.mjs: a small SVG path reader. It validates path data, returns the bounding box of the
// drawn geometry (curves and arcs are sampled, so control points do not inflate the box) and
// flattens a path into polylines for coverage tests (icon-coverage.mjs).

const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const SAMPLES = 24;

function tokenize(d) {
  const tokens = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)|([\s,]+)|(.)/g;
  let match;
  while ((match = re.exec(d)) !== null) {
    if (match[1]) tokens.push(match[1]);
    else if (match[2]) tokens.push(Number(match[2]));
    else if (match[4]) throw new Error(`unexpected character "${match[4]}" at ${match.index}`);
  }
  return tokens;
}

/** Points along an SVG arc (endpoint parameterization, SVG 1.1 appendix F.6). */
function arcPoints(x1, y1, [rxIn, ryIn, rotationDeg, largeArc, sweep], x2, y2, steps = SAMPLES * 2) {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [[x2, y2]];
  const phi = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const factor = (Boolean(largeArc) !== Boolean(sweep) ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (factor * rx * y1p) / ry;
  const cyp = (-factor * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const points = [];
  for (let k = 1; k <= steps; k += 1) {
    const t = theta1 + (delta * k) / steps;
    const px = rx * Math.cos(t);
    const py = ry * Math.sin(t);
    points.push([cos * px - sin * py + cx, sin * px + cos * py + cy]);
  }
  return points;
}

function cubicPoints(p0, p1, p2, p3, steps = SAMPLES) {
  const points = [];
  for (let k = 0; k <= steps; k += 1) {
    const t = k / steps;
    const u = 1 - t;
    points.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return points;
}

function quadPoints(p0, p1, p2, steps = SAMPLES) {
  const points = [];
  for (let k = 0; k <= steps; k += 1) {
    const t = k / steps;
    const u = 1 - t;
    points.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
  return points;
}

function readArgs(tokens, i, count) {
  const args = tokens.slice(i, i + count);
  if (args.length !== count || args.some((a) => typeof a !== 'number' || !Number.isFinite(a))) return null;
  return args;
}

/**
 * Walks SVG path data and calls emit('move' | 'line' | 'close', point). Curves and arcs are sampled
 * into `samples` line pieces (arcs twice as many). Throws an Error with a readable message.
 */
function trace(d, samples, emit) {
  if (typeof d !== 'string' || d.trim() === '') throw new Error('empty path');
  const tokens = tokenize(d);
  if (tokens[0] !== 'M' && tokens[0] !== 'm') throw new Error('path must start with M');
  const along = (points) => points.slice(1).forEach((p) => emit('line', p));
  let pos = [0, 0];
  let start = [0, 0];
  let lastCubic = null;
  let lastQuad = null;
  let cmd = null;
  let commands = 0;
  let i = 0;
  while (i < tokens.length) {
    if (typeof tokens[i] === 'string') {
      cmd = tokens[i];
      i += 1;
      commands += 1;
      if (cmd === 'Z' || cmd === 'z') {
        pos = start;
        lastCubic = null;
        lastQuad = null;
        emit('close', start);
        continue;
      }
    }
    const upper = cmd.toUpperCase();
    const args = readArgs(tokens, i, ARGS[upper]);
    if (args === null) throw new Error(`command ${cmd} needs ${ARGS[upper]} numbers`);
    i += ARGS[upper];
    const o = cmd === upper ? [0, 0] : pos;
    const at = (k) => [o[0] + args[k], o[1] + args[k + 1]];
    let next;
    let cubic = null;
    let quad = null;
    switch (upper) {
      case 'M':
        next = at(0);
        start = next;
        cmd = cmd === 'M' ? 'L' : 'l';
        emit('move', next);
        break;
      case 'L':
        next = at(0);
        emit('line', next);
        break;
      case 'T':
        next = at(0);
        quad = lastQuad ? [2 * pos[0] - lastQuad[0], 2 * pos[1] - lastQuad[1]] : pos;
        along(quadPoints(pos, quad, next, samples));
        break;
      case 'H':
        next = cmd === 'H' ? [args[0], pos[1]] : [pos[0] + args[0], pos[1]];
        emit('line', next);
        break;
      case 'V':
        next = cmd === 'V' ? [pos[0], args[0]] : [pos[0], pos[1] + args[0]];
        emit('line', next);
        break;
      case 'C':
        next = at(4);
        cubic = at(2);
        along(cubicPoints(pos, at(0), cubic, next, samples));
        break;
      case 'S': {
        next = at(2);
        const first = lastCubic ? [2 * pos[0] - lastCubic[0], 2 * pos[1] - lastCubic[1]] : pos;
        cubic = at(0);
        along(cubicPoints(pos, first, cubic, next, samples));
        break;
      }
      case 'Q':
        next = at(2);
        quad = at(0);
        along(quadPoints(pos, quad, next, samples));
        break;
      case 'A':
        next = [o[0] + args[5], o[1] + args[6]];
        along([pos, ...arcPoints(pos[0], pos[1], args, next[0], next[1], samples * 2)]);
        break;
      default:
        throw new Error(`unknown command ${cmd}`);
    }
    pos = next;
    lastCubic = cubic;
    lastQuad = quad;
  }
  return commands;
}

/** Returns { minX, minY, maxX, maxY, commands } or throws an Error with a readable message. */
export function pathBounds(d) {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const commands = trace(d, SAMPLES, (type, [px, py]) => {
    box.minX = Math.min(box.minX, px);
    box.minY = Math.min(box.minY, py);
    box.maxX = Math.max(box.maxX, px);
    box.maxY = Math.max(box.maxY, py);
  });
  if (!Number.isFinite(box.minX)) throw new Error('path draws nothing');
  return { ...box, commands };
}

/**
 * The path as polylines: [{ points: [[x, y], ...], closed }]. A drawing command after Z starts a
 * new subpath at the last start point, as in SVG. Throws like pathBounds.
 */
export function flattenPath(d, samples = 8) {
  const subpaths = [];
  let current = null;
  trace(d, samples, (type, point) => {
    if (type === 'move') {
      current = { points: [point], closed: false };
      subpaths.push(current);
    } else if (type === 'line') {
      current.points.push(point);
    } else {
      current.closed = true;
      current = { points: [point], closed: false };
      subpaths.push(current);
    }
  });
  return subpaths.filter((subpath) => subpath.points.length > 1);
}
