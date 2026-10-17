// A perceptual per-pixel difference, so the gates need no image package. It follows the method the
// pixelmatch library popularised (its threshold semantics are what the gate tolerances were measured
// with, threshold 0.1):
//   - colour difference in the YIQ space (Kotsarenko and Ramos, "Measuring perceived color
//     difference using YIQ NTSC transmission color space in mobile applications", 2010), with
//     semi-transparent pixels blended onto white first; a pair differs when the weighted squared
//     difference is above 35215 x threshold^2 (35215 is the largest possible value);
//   - anti-aliased pixels are not counted (Vysniauskas, "Anti-aliased pixel and intensity slope
//     detector", 2009): a pixel whose neighbourhood holds both a darker and a brighter extreme, where
//     that extreme sits in a flat area of both images, is an edge pixel drawn by a different rasteriser.
// Written for this skill from the published method; the structure gate's blob rule (at least 1.5 pt
// thick) does the rest, so small differences between implementations never decide a verdict.

const MAX_YIQ_DELTA = 35215;

function blend(c, a) {
  return 255 + (c - 255) * a;
}

function yOf(r, g, b) {
  return r * 0.29889531 + g * 0.58662247 + b * 0.11448223;
}

function iOf(r, g, b) {
  return r * 0.59597799 - g * 0.2741761 - b * 0.32180189;
}

function qOf(r, g, b) {
  return r * 0.21147017 - g * 0.52261711 + b * 0.31114694;
}

/** Signed YIQ difference of pixel k in a and pixel m in b (negative: a is lighter). yOnly: brightness only. */
export function colourDelta(a, b, k, m, yOnly = false) {
  let r1 = a[k];
  let g1 = a[k + 1];
  let b1 = a[k + 2];
  let r2 = b[m];
  let g2 = b[m + 1];
  let b2 = b[m + 2];
  const a1 = a[k + 3];
  const a2 = b[m + 3];
  if (a1 === a2 && r1 === r2 && g1 === g2 && b1 === b2) return 0;
  if (a1 < 255) {
    const f = a1 / 255;
    r1 = blend(r1, f);
    g1 = blend(g1, f);
    b1 = blend(b1, f);
  }
  if (a2 < 255) {
    const f = a2 / 255;
    r2 = blend(r2, f);
    g2 = blend(g2, f);
    b2 = blend(b2, f);
  }
  const y1 = yOf(r1, g1, b1);
  const y2 = yOf(r2, g2, b2);
  const dy = y1 - y2;
  if (yOnly) return dy;
  const di = iOf(r1, g1, b1) - iOf(r2, g2, b2);
  const dq = qOf(r1, g1, b1) - qOf(r2, g2, b2);
  const delta = 0.5053 * dy * dy + 0.299 * di * di + 0.1957 * dq * dq;
  return y1 > y2 ? -delta : delta;
}

/** Three or more of the 8 neighbours of (x, y) are exactly the pixel's colour (a flat area). */
function flatAround(img, x, y, width, height) {
  const x0 = Math.max(x - 1, 0);
  const y0 = Math.max(y - 1, 0);
  const x2 = Math.min(x + 1, width - 1);
  const y2 = Math.min(y + 1, height - 1);
  const at = (y * width + x) * 4;
  let same = x === x0 || x === x2 || y === y0 || y === y2 ? 1 : 0;
  for (let nx = x0; nx <= x2; nx += 1) {
    for (let ny = y0; ny <= y2; ny += 1) {
      if (nx === x && ny === y) continue;
      const j = (ny * width + nx) * 4;
      if (img[at] === img[j] && img[at + 1] === img[j + 1] && img[at + 2] === img[j + 2] && img[at + 3] === img[j + 3]) same += 1;
      if (same > 2) return true;
    }
  }
  return false;
}

/** Is (x, y) of img an anti-aliased edge pixel (judged against the other image)? */
export function isAntiAliased(img, x, y, width, height, other) {
  const x0 = Math.max(x - 1, 0);
  const y0 = Math.max(y - 1, 0);
  const x2 = Math.min(x + 1, width - 1);
  const y2 = Math.min(y + 1, height - 1);
  const at = (y * width + x) * 4;
  let zeroes = x === x0 || x === x2 || y === y0 || y === y2 ? 1 : 0;
  let darkest = 0;
  let brightest = 0;
  let darkX = 0;
  let darkY = 0;
  let brightX = 0;
  let brightY = 0;
  for (let nx = x0; nx <= x2; nx += 1) {
    for (let ny = y0; ny <= y2; ny += 1) {
      if (nx === x && ny === y) continue;
      const d = colourDelta(img, img, at, (ny * width + nx) * 4, true);
      if (d === 0) {
        zeroes += 1;
        if (zeroes > 2) return false;
      } else if (d < darkest) {
        darkest = d;
        darkX = nx;
        darkY = ny;
      } else if (d > brightest) {
        brightest = d;
        brightX = nx;
        brightY = ny;
      }
    }
  }
  if (darkest === 0 || brightest === 0) return false;
  return (flatAround(img, darkX, darkY, width, height) && flatAround(other, darkX, darkY, width, height))
    || (flatAround(img, brightX, brightY, width, height) && flatAround(other, brightX, brightY, width, height));
}

/**
 * Compare two RGBA buffers of equal size. Writes an image into `out` when given (differences in
 * diffColor, or diffColorAlt where image a is lighter; anti-aliased pixels in aaColor; the rest a
 * faded grey copy of a, unless diffMask, which leaves them transparent). Returns the number of
 * differing pixels (anti-aliased ones excluded).
 */
export function pixelDiff(a, b, out, width, height, options = {}) {
  const { threshold = 0.1, alpha = 0.1, aaColor = [255, 255, 0], diffColor = [255, 0, 0], diffColorAlt = null, diffMask = false, includeAA = false } = options;
  if (a.length !== b.length || a.length !== width * height * 4 || (out && out.length !== a.length)) throw new Error('pixelDiff: image sizes do not match');
  const maxDelta = MAX_YIQ_DELTA * threshold * threshold;
  const put = (i, rgb) => {
    out[i] = rgb[0];
    out[i + 1] = rgb[1];
    out[i + 2] = rgb[2];
    out[i + 3] = 255;
  };
  const grey = (i) => {
    const v = blend(yOf(a[i], a[i + 1], a[i + 2]), (alpha * a[i + 3]) / 255);
    out[i] = v;
    out[i + 1] = v;
    out[i + 2] = v;
    out[i + 3] = 255;
  };
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const delta = a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2] && a[i + 3] === b[i + 3] ? 0 : colourDelta(a, b, i, i);
      if (Math.abs(delta) > maxDelta) {
        if (!includeAA && (isAntiAliased(a, x, y, width, height, b) || isAntiAliased(b, x, y, width, height, a))) {
          if (out && !diffMask) put(i, aaColor);
        } else {
          if (out) put(i, delta < 0 && diffColorAlt ? diffColorAlt : diffColor);
          count += 1;
        }
      } else if (out && !diffMask) grey(i);
    }
  }
  return count;
}
